'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BUILTIN_DEMO } from '@/lib/demos';
import {
  EMPTY_HISTORY_STATE,
  HistoryController,
  MAX_PAGES,
  type HistoryState,
} from '@/lib/client/history-controller';
import { nextSpeed, stepMs } from '@/lib/playback/machine';
import { describePlayableRange } from '@/lib/range';
import type { RepoRef } from '@/lib/repo-ref';
import { buildAppUrl, parseAppUrl, type AppView } from '@/lib/url/state';
import { CompareView } from './CompareView';
import type { PickerChoice } from './ComparePicker';
import { InsightsView } from './InsightsView';
import { Overlay } from './Overlay';
import { ReplayView, type SubView } from './ReplayView';
import { RepoInput } from './RepoInput';
import type { OpenedDiff } from './FileChangeList';
import { EMPTY_TREE_VIEW, type TreeViewState } from './TreePanel';
import { GitHubUsage, SourceStatus } from './SourceStatus';
import { EmptyRepoState, ErrorState, HowItWorks, Landing, LoadingState } from './States';
import { TopBar } from './TopBar';
import { usePrefersReducedMotion } from './hooks';
import styles from './shell.module.css';

const VIEWS: { id: AppView; label: string }[] = [
  { id: 'replay', label: 'Replay' },
  { id: 'compare', label: 'Compare' },
  { id: 'insights', label: 'Insights' },
];

/** What the skip link should land on, per view. */
const SKIP_LABEL: Record<AppView, string> = {
  replay: 'Skip to the commit and its changes',
  compare: 'Skip to the comparison',
  insights: 'Skip to the insights',
};

export function TimeMachine() {
  // The controller is created once and never replaced; useState's initialiser is
  // the pattern for that, and keeps it out of ref-during-render territory.
  const [controller] = useState(() => new HistoryController());

  const state = useSyncExternalStore<HistoryState>(
    controller.subscribe,
    controller.getState,
    () => EMPTY_HISTORY_STATE,
  );

  const [overlay, setOverlay] = useState<'repo' | 'help' | null>(null);

  /*
   * Replay's own view state lives here, not in `ReplayView`.
   *
   * That component unmounts when the visitor switches to Compare or Insights,
   * so anything it held locally was gone on the way back: the sub-view reset to
   * Repository, the path filter emptied, folders the visitor had opened closed
   * again. All of it is something they chose, so the shell keeps it.
   */
  const [subView, setSubView] = useState<SubView>('repository');
  const [diffFocus, setDiffFocus] = useState<{ path: string } | null>(null);
  const [openedDiff, setOpenedDiff] = useState<OpenedDiff | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [treeView, setTreeView] = useState<TreeViewState>(EMPTY_TREE_VIEW);

  const playback = state.playback;
  const currentCommit = state.commits[playback.index] ?? null;
  const reducedMotion = usePrefersReducedMotion();
  const view = state.view;

  useEffect(() => () => controller.dispose(), [controller]);

  // ------------------------------------------------------------ URL <-> state

  const applyUrl = useCallback(
    (search: string) => {
      const parsed = parseAppUrl(search);
      if (parsed.repo) {
        void controller.load(parsed.repo, parsed.commit, parsed.compare ?? null, parsed.view);
      } else {
        controller.reset();
      }
    },
    [controller],
  );

  // Read the address bar once on mount. Doing this in an effect rather than
  // during render keeps the server and client markup identical.
  useEffect(() => {
    applyUrl(window.location.search);
    const onPopState = () => applyUrl(window.location.search);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyUrl]);

  /**
   * The address bar mirrors the state, and a deliberate act pushes an entry.
   *
   * Playback replaces, so a minute of playing does not bury the entry the
   * visitor arrived on; navigating, jumping and running a comparison push, so
   * Back undoes exactly the thing that was just done.
   */
  const pushNext = useRef(false);
  const shareUrl = useMemo(() => {
    if (!state.ref) return '/';
    // Only a comparison that actually ran is shareable; a draft describes nothing.
    if (view === 'compare' && state.compare.base && state.compare.head && state.compare.data) {
      return buildAppUrl({
        repo: state.ref,
        commit: null,
        compare: { base: state.compare.base, head: state.compare.head },
        view: 'compare',
      });
    }
    return buildAppUrl({
      repo: state.ref,
      commit: currentCommit?.sha ?? null,
      compare: null,
      view: view === 'insights' ? 'insights' : 'replay',
    });
  }, [state.ref, view, state.compare.base, state.compare.head, state.compare.data, currentCommit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = `${window.location.pathname}${window.location.search}`;
    if (shareUrl === current) {
      pushNext.current = false;
      return;
    }
    window.history[pushNext.current ? 'pushState' : 'replaceState'](null, '', shareUrl);
    pushNext.current = false;
  }, [shareUrl]);

  const openRepo = useCallback(
    (ref: RepoRef) => {
      pushNext.current = true;
      setOverlay(null);
      // A different repository has a different tree, so none of that carries over.
      setSubView('repository');
      setDiffFocus(null);
      setOpenedDiff(null);
      setExpanded(false);
      setTreeView(EMPTY_TREE_VIEW);
      void controller.load(ref);
    },
    [controller],
  );

  const clearRepo = useCallback(() => {
    pushNext.current = true;
    setOverlay(null);
    controller.reset();
  }, [controller]);

  const openBuiltinDemo = useCallback(() => {
    openRepo(BUILTIN_DEMO.ref);
  }, [openRepo]);

  const dispatch = controller.dispatchPlayback;

  const seek = useCallback(
    (index: number, options: { push?: boolean } = {}) => {
      if (options.push) pushNext.current = true;
      dispatch({ type: 'seek', index });
    },
    [dispatch],
  );

  // ------------------------------------------------------------------- views

  /**
   * Opening the comparison.
   *
   * A pair is proposed straight away and run once. Returning to a comparison
   * that is already loaded re-runs nothing.
   *
   * The default is the step before the current commit and the current commit —
   * "what did the last step do" — except at the very first commit, where there
   * is no step before it and the useful comparison is the whole loaded range.
   * Offering a commit compared with itself would answer nothing.
   */
  const openCompareView = useCallback(() => {
    pushNext.current = true;
    const existing = state.compare;
    if (existing.draftBase && existing.draftHead) {
      controller.setView('compare');
      return;
    }

    const current = currentCommit ?? state.commits[state.commits.length - 1];
    if (!current) {
      controller.setView('compare');
      return;
    }

    const previous = state.commits[current.index - 1];
    const newest = state.commits[state.commits.length - 1]!;
    const pair = previous
      ? { base: previous, head: current }
      : { base: current, head: newest };

    if (pair.base.sha === pair.head.sha) {
      // One commit in range: offer the pair and explain, rather than request it.
      controller.prepareCompare(pair.base.sha, pair.head.sha);
    } else {
      controller.openCompare(pair.base.sha, pair.head.sha);
    }
  }, [controller, currentCommit, state.commits, state.compare]);

  const selectView = useCallback(
    (next: AppView) => {
      if (next === view) return;
      if (next === 'compare') {
        openCompareView();
        return;
      }
      pushNext.current = true;
      controller.setView(next);
    },
    [controller, openCompareView, view],
  );

  const pickCompareEnd = useCallback(
    (side: 'base' | 'head', choice: PickerChoice) => {
      controller.setCompareDraft(side, choice.sha, choice.tagName);
    },
    [controller],
  );

  const submitCompare = useCallback(() => {
    pushNext.current = true;
    controller.submitCompare();
  }, [controller]);

  /** The one place a comparison is allowed to move the replay. */
  const openInReplay = useCallback(
    (index: number) => {
      pushNext.current = true;
      controller.setView('replay');
      dispatch({ type: 'seek', index });
    },
    [controller, dispatch],
  );

  const inspectFromInsights = useCallback(
    (index: number) => {
      pushNext.current = true;
      controller.setView('replay');
      dispatch({ type: 'seek', index });
    },
    [controller, dispatch],
  );

  // ---------------------------------------------------------------- playback

  useEffect(() => {
    if (!playback.playing) return;
    // Recreating the interval on a speed change leaves position and play state
    // untouched, which is the behaviour the transport promises.
    const id = setInterval(() => dispatch({ type: 'tick' }), stepMs(playback.speed));
    return () => clearInterval(id);
  }, [dispatch, playback.playing, playback.speed]);

  // The selected commit's diff is what the detail panel shows, so it is always
  // fetched, ahead of the background queue.
  useEffect(() => {
    if (!currentCommit) return;
    controller.prioritise(currentCommit.sha);
    void controller.ensureDetail(currentCommit.sha);
  }, [controller, currentCommit]);

  // When the visitor settles on a commit, one tree request makes the file list
  // exact. This deliberately does not run while playing.
  useEffect(() => {
    if (playback.playing || !currentCommit) return;
    const id = setTimeout(() => void controller.ensureExactTree(playback.index), 500);
    return () => clearTimeout(id);
  }, [controller, currentCommit, playback.index, playback.playing]);

  // --------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Playback shortcuts belong to the replay, and to nothing on top of it.
      if (view !== 'replay') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault();
          dispatch({ type: 'toggle' });
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (event.shiftKey) dispatch({ type: 'seek', index: playback.index + 10 });
          else dispatch({ type: 'next' });
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (event.shiftKey) dispatch({ type: 'seek', index: playback.index - 10 });
          else dispatch({ type: 'previous' });
          break;
        case 'Home':
          event.preventDefault();
          dispatch({ type: 'first' });
          break;
        case 'End':
          event.preventDefault();
          dispatch({ type: 'last' });
          break;
        case '[':
          dispatch({ type: 'setSpeed', speed: nextSpeed(playback.speed, -1) });
          break;
        case ']':
          dispatch({ type: 'setSpeed', speed: nextSpeed(playback.speed, 1) });
          break;
        case 'f':
        case 'F':
          // The same toggle as the button, for somebody already on the keyboard.
          event.preventDefault();
          setExpanded((current) => !current);
          break;
        case '/': {
          const filter = document.getElementById('tree-filter');
          if (filter) {
            event.preventDefault();
            filter.focus();
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, playback.index, playback.speed, view]);

  // ---------------------------------------------------------------- derived

  const projection = useMemo(
    () => controller.projector.project(playback.index),
    // The projector is mutable, so `version` is the signal that it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, playback.index, state.version],
  );

  // Projections at the two ends of a comparison, for the statistics table.
  const compareProjections = useMemo(() => {
    if (view !== 'compare' || !state.compare.data) return { base: null, head: null };
    const find = (sha: string) => state.commits.find((commit) => commit.sha.startsWith(sha));
    const base = find(state.compare.data.base.sha);
    const head = find(state.compare.data.head.sha);
    return {
      base: base ? controller.projector.project(base.index) : null,
      head: head ? controller.projector.project(head.index) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, state.commits, view, state.compare.data, state.version]);

  const commitMilestones = useMemo(
    () => state.milestones.filter((milestone) => milestone.commitIndex === playback.index),
    [state.milestones, playback.index],
  );

  const detail = currentCommit ? (controller.details.get(currentCommit.sha) ?? null) : null;

  const rangeLabel = useMemo(
    () => describePlayableRange(state.commits.length, state.totalCommits),
    [state.commits.length, state.totalCommits],
  );

  const busy = state.status === 'loading';
  const ready = state.status === 'ready' && state.commits.length > 0;
  // Comes from the server, never inferred from a label.
  const isBuiltin = state.meta?.dataSource === 'builtin';
  const title = isBuiltin ? BUILTIN_DEMO.title : (state.ref?.slug ?? 'Repository');

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        {SKIP_LABEL[view]}
      </a>

      <TopBar
        repoLabel={state.status === 'idle' ? null : (state.ref?.slug ?? null)}
        onChangeRepo={() => setOverlay('repo')}
        onOpenHelp={() => setOverlay('help')}
      />

      {state.status === 'idle' ? (
        <main className={styles.stage} id="main">
          <Landing
            onOpenDemo={openBuiltinDemo}
            onSelect={openRepo}
            onOpenHelp={() => setOverlay('help')}
            busy={busy}
          />
        </main>
      ) : (
        <>
          <div className={styles.workspaceHead}>
            {/*
             * The name is the heading; where the data came from is metadata. On
             * one line the two competed, and the disclosure made the heading
             * look like a sentence rather than a title.
             */}
            <div className={styles.titleRow}>
              <h1 className={styles.title} title={state.ref?.slug ?? undefined}>
                {title}
              </h1>
              {!isBuiltin && state.meta ? (
                <div className={styles.usage}>
                  <GitHubUsage
                    snapshot={state.rateLimit}
                    ageMs={state.rateLimitAgeMs}
                    tokenConfigured={state.tokenConfigured}
                    onOpenDemo={openBuiltinDemo}
                  />
                </div>
              ) : null}
            </div>

            <div className={styles.sourceRow}>
              <SourceStatus meta={state.meta} loading={busy} />
            </div>

            <nav className={styles.viewTabs} role="tablist" aria-label="What to look at">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  className={styles.viewTab}
                  aria-selected={view === item.id}
                  aria-controls="main"
                  tabIndex={view === item.id ? 0 : -1}
                  disabled={!ready && item.id !== 'replay'}
                  onClick={() => selectView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {state.densify.active ? (
            <DensifyBar done={state.densify.done} target={state.densify.target} />
          ) : null}

          {state.notices.length > 0 ? (
            <div className={styles.notices} role="status" aria-live="polite">
              {state.notices.map((notice) => (
                <p key={notice} className={styles.notice}>
                  <span className={styles.noticeIcon} aria-hidden="true">
                    !
                  </span>
                  {notice}
                </p>
              ))}
            </div>
          ) : null}

          <main className={styles.stage} id="main">
            {state.status === 'loading' ? <LoadingState slug={state.ref?.slug ?? null} /> : null}

            {state.status === 'error' && state.error ? (
              <ErrorState
                error={state.error}
                slug={state.ref?.slug ?? null}
                onRetry={() => state.ref && void controller.load(state.ref)}
                onClear={() => setOverlay('repo')}
                onOpenDemo={openBuiltinDemo}
              />
            ) : null}

            {state.status === 'ready' && state.commits.length === 0 ? (
              <EmptyRepoState
                slug={state.ref?.slug ?? ''}
                onClear={() => setOverlay('repo')}
                onOpenDemo={openBuiltinDemo}
              />
            ) : null}

            {ready && view === 'replay' ? (
              <ReplayView
                commits={state.commits}
                playback={playback}
                currentCommit={currentCommit}
                previousCommit={playback.index > 0 ? (state.commits[playback.index - 1] ?? null) : null}
                detail={detail}
                detailPending={Boolean(currentCommit) && !detail}
                details={controller.details}
                projection={projection}
                commitMilestones={commitMilestones}
                milestones={state.milestones}
                tags={state.tags}
                totalCommits={state.totalCommits}
                hasOlder={state.hasOlder}
                loadingOlder={state.loadingOlder}
                canLoadOlder={state.pagesLoaded < MAX_PAGES}
                snapshotLoading={state.snapshotCount === 0}
                rangeLabel={rangeLabel}
                version={state.version}
                reducedMotion={reducedMotion}
                onSeek={seek}
                onPlayPause={() => dispatch({ type: 'toggle' })}
                onNext={() => dispatch({ type: 'next' })}
                onPrevious={() => dispatch({ type: 'previous' })}
                onLatest={() => seek(state.commits.length - 1, { push: true })}
                onSpeed={(speed) => dispatch({ type: 'setSpeed', speed })}
                onLoadOlder={() => void controller.loadOlder()}
                onPause={controller.pausePlayback}
                onShowMilestones={() => selectView('insights')}
                subView={subView}
                onSubView={setSubView}
                diffFocus={diffFocus}
                openedDiff={openedDiff}
                onOpenedDiff={setOpenedDiff}
                expanded={expanded}
                onExpanded={setExpanded}
                onDiffFocus={setDiffFocus}
                treeView={treeView}
                onTreeView={setTreeView}
              />
            ) : null}

            {ready && view === 'compare' ? (
              <CompareView
                compare={state.compare}
                commits={state.commits}
                tags={state.tags}
                tagsStatus={state.tagsStatus}
                baseProjection={compareProjections.base}
                headProjection={compareProjections.head}
                onPick={pickCompareEnd}
                onSwap={controller.swapCompareDraft}
                onSubmit={submitCompare}
                onRetry={controller.retryCompare}
                onOpenInReplay={openInReplay}
              />
            ) : null}

            {ready && view === 'insights' ? (
              <InsightsView
                meta={state.meta}
                commits={state.commits}
                currentIndex={playback.index}
                projection={projection}
                growth={state.growth}
                activity={state.activity}
                milestones={state.milestones}
                densify={state.densify}
                totalCommits={state.totalCommits}
                hasOlder={state.hasOlder}
                loadingOlder={state.loadingOlder}
                canLoadOlder={state.pagesLoaded < MAX_PAGES}
                onInspect={inspectFromInsights}
                onSeek={(index) => seek(index)}
                onLoadOlder={() => void controller.loadOlder()}
              />
            ) : null}
          </main>
        </>
      )}

      {overlay === 'repo' ? (
        <Overlay title="Open a repository" onClose={() => setOverlay(null)}>
          <div className={styles.repoOverlay}>
            {/* Cancelling leaves whatever is loaded exactly as it was. */}
            <RepoInput
              current={state.ref}
              busy={busy}
              onSubmit={openRepo}
              onCancel={() => setOverlay(null)}
              autoFocus
              emphasis="primary"
            />
            {!isBuiltin ? (
              <button type="button" className={styles.overlayDemo} onClick={openBuiltinDemo}>
                Explore the built-in demo instead
              </button>
            ) : null}
            {state.ref ? (
              <button type="button" className={styles.overlayClear} onClick={clearRepo}>
                Start over from the home screen
              </button>
            ) : null}
          </div>
        </Overlay>
      ) : null}

      {overlay === 'help' ? (
        <Overlay title="How it works" onClose={() => setOverlay(null)}>
          <HowItWorks />
        </Overlay>
      ) : null}
    </div>
  );
}

/** Background diff loading, as a hairline. It is progress, not a headline. */
function DensifyBar({ done, target }: { done: number; target: number }) {
  const share = target === 0 ? 0 : Math.min(1, done / target);
  return (
    <div
      className={styles.densify}
      role="progressbar"
      aria-label="Loading commit diffs in the background"
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={done}
    >
      <span className={styles.densifyFill} style={{ width: `${share * 100}%` }} />
    </div>
  );
}
