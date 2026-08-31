'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BUILTIN_DEMO } from '@/lib/demos';
import {
  EMPTY_HISTORY_STATE,
  HistoryController,
  MAX_PAGES,
  type HistoryState,
} from '@/lib/client/history-controller';
import { formatNumber } from '@/lib/format';
import { nextSpeed, stepMs } from '@/lib/playback/machine';
import type { RepoRef } from '@/lib/repo-ref';
import { buildAppUrl, parseAppUrl } from '@/lib/url/state';
import { CommitPanel } from './CommitPanel';
import { ComparePanel } from './ComparePanel';
import type { PickerChoice } from './ComparePicker';
import { InsightsPanel } from './InsightsPanel';
import { RateLimitMeter } from './RateLimitMeter';
import { RepoInput } from './RepoInput';
import { BuiltinGlyph, EmptyRepoState, ErrorState, Landing, LoadingState } from './States';
import { Transport } from './Transport';
import { TreePanel } from './TreePanel';
import { usePrefersReducedMotion } from './hooks';
import styles from './shell.module.css';

export function TimeMachine() {
  // The controller is created once and never replaced; useState's initialiser is
  // the pattern for that, and keeps it out of ref-during-render territory.
  const [controller] = useState(() => new HistoryController());

  const state = useSyncExternalStore<HistoryState>(
    controller.subscribe,
    controller.getState,
    () => EMPTY_HISTORY_STATE,
  );

  const playback = state.playback;
  const currentCommit = state.commits[playback.index] ?? null;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => () => controller.dispose(), [controller]);

  // ------------------------------------------------------------ URL <-> state

  const applyUrl = useCallback(
    (search: string) => {
      const parsed = parseAppUrl(search);
      if (parsed.repo) {
        void controller.load(parsed.repo, parsed.commit, parsed.compare ?? null);
        // Back out of a comparison when the entry being restored has none.
        if (!parsed.compare) controller.closeCompare();
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

  const writeUrl = useCallback(
    (
      ref: RepoRef | null,
      sha: string | null,
      mode: 'push' | 'replace',
      compare: { base: string; head: string } | null = null,
    ) => {
      if (typeof window === 'undefined') return;
      const next = buildAppUrl({ repo: ref, commit: sha, compare });
      const current = `${window.location.pathname}${window.location.search}`;
      if (next === current) return;
      window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', next);
    },
    [],
  );

  const openRepo = useCallback(
    (ref: RepoRef) => {
      writeUrl(ref, null, 'push');
      void controller.load(ref);
    },
    [controller, writeUrl],
  );

  const clearRepo = useCallback(() => {
    writeUrl(null, null, 'push');
    controller.reset();
  }, [controller, writeUrl]);

  const openBuiltinDemo = useCallback(() => {
    openRepo(BUILTIN_DEMO.ref);
  }, [openRepo]);

  // Keep the share URL current. Playback steps replace the entry; deliberate
  // jumps push one, so Back returns to where the visitor jumped from.
  const lastPushedRef = useRef<string | null>(null);
  const compareOpen = state.compare.open;
  const compareBase = state.compare.base;
  const compareHead = state.compare.head;

  useEffect(() => {
    if (!state.ref) return;

    // The two views own the address bar in turn, never at the same time.
    if (compareOpen && compareBase && compareHead) {
      writeUrl(state.ref, null, 'replace', { base: compareBase, head: compareHead });
      return;
    }

    if (!currentCommit) return;
    const mode = lastPushedRef.current === currentCommit.sha ? 'push' : 'replace';
    writeUrl(state.ref, currentCommit.sha, mode);
    lastPushedRef.current = null;
  }, [state.ref, currentCommit, writeUrl, compareOpen, compareBase, compareHead]);

  const dispatch = controller.dispatchPlayback;

  /**
   * Opens the comparison with a sensible pair already chosen: the commit in view
   * as head, and the previous release tag — or the start of the loaded range —
   * as base, which is the comparison people most often want.
   */
  const openCompare = useCallback(() => {
    const head = currentCommit ?? state.commits[state.commits.length - 1];
    if (!head) return;

    const earlierTags = state.tags
      .map((tag) => ({ tag, index: state.commits.findIndex((commit) => commit.sha === tag.sha) }))
      .filter((entry) => entry.index >= 0 && entry.index < head.index)
      .sort((a, b) => b.index - a.index);

    const base = earlierTags[0]?.tag.sha ?? state.commits[0]?.sha;
    if (!base || base === head.sha) {
      // Nothing earlier to compare against; still open, with both ends the same,
      // so the picker is there to change one.
      controller.openCompare(head.sha, head.sha);
      return;
    }
    controller.openCompare(base, head.sha, { base: earlierTags[0]?.tag.name ?? null });
  }, [controller, currentCommit, state.commits, state.tags]);

  const pickCompareEnd = useCallback(
    (side: 'base' | 'head', choice: PickerChoice) => {
      controller.setCompareEnd(side, choice.sha, choice.tagName);
    },
    [controller],
  );

  const closeCompare = useCallback(() => {
    controller.closeCompare();
    // Hand the address bar back to the timeline.
    if (state.ref && currentCommit) writeUrl(state.ref, currentCommit.sha, 'push');
  }, [controller, state.ref, currentCommit, writeUrl]);

  const seekFromCompare = useCallback(
    (index: number) => {
      controller.closeCompare();
      dispatch({ type: 'seek', index });
    },
    [controller, dispatch],
  );

  const seek = useCallback(
    (index: number, options: { push?: boolean } = {}) => {
      if (options.push) {
        const target = state.commits[index];
        if (target) lastPushedRef.current = target.sha;
      }
      dispatch({ type: 'seek', index });
    },
    [dispatch, state.commits],
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
  }, [dispatch, playback.index, playback.speed]);

  // ---------------------------------------------------------------- derived

  const projection = useMemo(
    () => controller.projector.project(playback.index),
    // The projector is mutable, so `version` is the signal that it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, playback.index, state.version],
  );

  // Projections at the two ends of a comparison, for the side-by-side column.
  const compareProjections = useMemo(() => {
    if (!state.compare.open || !state.compare.data) return { base: null, head: null };
    const find = (sha: string) => state.commits.find((commit) => commit.sha.startsWith(sha));
    const base = find(state.compare.data.base.sha);
    const head = find(state.compare.data.head.sha);
    return {
      base: base ? controller.projector.project(base.index) : null,
      head: head ? controller.projector.project(head.index) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, state.commits, state.compare.open, state.compare.data, state.version]);

  const commitMilestones = useMemo(
    () => state.milestones.filter((milestone) => milestone.commitIndex === playback.index),
    [state.milestones, playback.index],
  );

  const detail = currentCommit ? (controller.details.get(currentCommit.sha) ?? null) : null;

  const rangeLabel = useMemo(() => {
    const count = state.commits.length;
    if (count === 0) return 'no commits loaded';
    if (state.totalCommits === null) return `${formatNumber(count)} commits loaded`;
    if (count >= state.totalCommits) return `full history — ${formatNumber(count)} commits`;
    return `latest ${formatNumber(count)} of ${formatNumber(state.totalCommits)} commits`;
  }, [state.commits.length, state.totalCommits]);

  const busy = state.status === 'loading';
  const showTimeline = state.status === 'ready' && state.commits.length > 0;
  // Comes from the server, never inferred from a label.
  const isBuiltin = state.meta?.dataSource === 'builtin';

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to the timeline
      </a>

      {/* Exactly one H1 in every state: the landing screen provides its own, so
          this one only appears once a repository or the demo is open. */}
      {state.status === 'idle' ? null : (
        <h1 className="visually-hidden">
          {state.compare.open
            ? `${isBuiltin ? BUILTIN_DEMO.title : (state.ref?.slug ?? 'Repository')} — comparing two points`
            : isBuiltin
              ? `${BUILTIN_DEMO.title} — built-in demo timeline`
              : `${state.ref?.slug ?? 'Repository'} — commit timeline`}
        </h1>
      )}

      <header className={styles.header}>
        <div className={styles.brand}>
          <BrandMark />
          <span className={styles.brandText}>
            <span className={styles.brandName}>Repo Time Machine</span>
            <span className={styles.brandSub}>git history, played back</span>
          </span>
        </div>

        <div className={styles.headerMain}>
          {/* The landing screen has its own, larger field; two would be noise. */}
          {state.status === 'idle' ? null : (
            <RepoInput current={state.ref} busy={busy} onSubmit={openRepo} />
          )}
        </div>

        <div className={styles.headerAside}>
          {isBuiltin ? (
            <p className={styles.builtinBadge}>
              <BuiltinGlyph />
              {BUILTIN_DEMO.badge}
              <span className={styles.builtinCost}>&middot; 0 GitHub requests</span>
            </p>
          ) : state.status === 'idle' ? null : (
            <RateLimitMeter
              snapshot={state.rateLimit}
              ageMs={state.rateLimitAgeMs}
              tokenConfigured={state.tokenConfigured}
            />
          )}
          <a
            className={styles.sourceLink}
            href="https://github.com/renrenmimi/RepoTimeMachine"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source
          </a>
        </div>
      </header>

      <div className={styles.sourceBar} hidden={state.status === 'idle'}>
        {isBuiltin ? (
          <p className={styles.sourceNote}>
            <span className={styles.sourceStrong}>{BUILTIN_DEMO.title}</span>
            {/* Repeated in full in the insights panel, so it can drop on a phone. */}
            <span className={styles.sourceDetail}>{BUILTIN_DEMO.disclosure}</span>
          </p>
        ) : (
          <p className={styles.sourceNote}>
            <span className={styles.sourceStrong}>Live repository</span>
            <span className={styles.sourceDetail}>Read from GitHub&rsquo;s public REST API.</span>
          </p>
        )}
        <span className={styles.sourceSpacer} />
        {showTimeline && !state.compare.open ? (
          <button type="button" className={styles.sourceButton} onClick={openCompare}>
            <CompareGlyph />
            Compare
          </button>
        ) : null}
        {isBuiltin ? null : (
          <button type="button" className={styles.sourceButton} onClick={openBuiltinDemo}>
            <BuiltinGlyph />
            Built-in demo
          </button>
        )}
        {state.ref ? (
          <button type="button" className={styles.sourceButton} onClick={clearRepo}>
            Start over
          </button>
        ) : null}
      </div>

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

      <main className={styles.stage} id="main">
        {state.status === 'idle' ? (
          <Landing onOpenDemo={openBuiltinDemo} onSelect={openRepo} busy={busy} />
        ) : null}

        {state.status === 'loading' ? <LoadingState slug={state.ref?.slug ?? null} /> : null}

        {state.status === 'error' && state.error ? (
          <ErrorState
            error={state.error}
            slug={state.ref?.slug ?? null}
            onRetry={() => state.ref && void controller.load(state.ref)}
            onClear={clearRepo}
            onOpenDemo={openBuiltinDemo}
          />
        ) : null}

        {state.status === 'ready' && state.commits.length === 0 ? (
          <EmptyRepoState slug={state.ref?.slug ?? ''} onClear={clearRepo} />
        ) : null}

        {showTimeline && state.compare.open ? (
          <ComparePanel
            compare={state.compare}
            commits={state.commits}
            tags={state.tags}
            baseProjection={compareProjections.base}
            headProjection={compareProjections.head}
            onPick={pickCompareEnd}
            onSwap={controller.swapCompare}
            onClose={closeCompare}
            onSeek={seekFromCompare}
          />
        ) : null}

        {showTimeline && !state.compare.open ? (
          <div className={styles.grid}>
            <TreePanel
              className={styles.gridTree}
              projection={projection}
              commits={state.commits}
              currentIndex={playback.index}
              details={controller.details}
              loading={state.snapshotCount === 0}
              version={state.version}
              onSeek={(index) => seek(index, { push: true })}
            />

            <CommitPanel
              className={styles.gridCommit}
              commit={currentCommit}
              previous={playback.index > 0 ? (state.commits[playback.index - 1] ?? null) : null}
              detail={detail}
              detailPending={Boolean(currentCommit) && !detail}
              milestones={commitMilestones}
              playing={playback.playing && !reducedMotion}
            />

            <InsightsPanel
                className={styles.gridInsights}
                meta={state.meta}
                commits={state.commits}
                currentIndex={playback.index}
                projection={projection}
                growth={state.growth}
                activity={state.activity}
                milestones={state.milestones}
                totalCommits={state.totalCommits}
                hasOlder={state.hasOlder}
                loadingOlder={state.loadingOlder}
                canLoadOlder={state.pagesLoaded < MAX_PAGES}
                onSeek={(index) => seek(index, { push: true })}
                onLoadOlder={() => void controller.loadOlder()}
              />
          </div>
        ) : null}
      </main>

      {showTimeline && !state.compare.open ? (
        <div className={styles.transportSlot}>
          {state.densify.active ? (
            <DensifyBar done={state.densify.done} target={state.densify.target} />
          ) : null}
          <Transport
            playback={playback}
            commits={state.commits}
            milestones={state.milestones}
            rangeLabel={rangeLabel}
            disabled={false}
            onPlayPause={() => dispatch({ type: 'toggle' })}
            onNext={() => dispatch({ type: 'next' })}
            onPrevious={() => dispatch({ type: 'previous' })}
            onSeek={(index) => seek(index)}
            onSpeed={(speed) => dispatch({ type: 'setSpeed', speed })}
          />
        </div>
      ) : null}
    </div>
  );
}

function DensifyBar({ done, target }: { done: number; target: number }) {
  const share = target === 0 ? 0 : Math.min(1, done / target);
  return (
    <div
      style={{
        height: 2,
        background: 'var(--line-faint)',
        position: 'relative',
      }}
      role="progressbar"
      aria-label="Loading commit diffs in the background"
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={done}
    >
      <span
        style={{
          position: 'absolute',
          inset: '0 auto 0 0',
          width: `${share * 100}%`,
          background: 'var(--signal-dim)',
          transition: 'width var(--duration) var(--ease-out)',
        }}
      />
    </div>
  );
}

function CompareGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1" y="2.2" width="3.6" height="7.6" rx="1" />
      <rect x="7.4" y="2.2" width="3.6" height="7.6" rx="1" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="var(--surface-inset)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="11.25" fill="none" stroke="var(--line)" strokeWidth="1.5" />
      <circle cx="21" cy="26" r="9" fill="none" stroke="var(--signal-dim)" strokeWidth="2.5" />
      <circle cx="21" cy="26" r="2.5" fill="var(--signal)" />
      <circle cx="43" cy="26" r="6" fill="none" stroke="var(--signal-dim)" strokeWidth="2.5" />
      <circle cx="43" cy="26" r="2" fill="var(--signal)" />
      <path d="M21 35 Q32 41 43 32" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="49" x2="52" y2="49" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
      <line x1="18" y1="45.5" x2="18" y2="52.5" stroke="var(--signal-dim)" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="45.5" x2="26" y2="52.5" stroke="var(--signal-dim)" strokeWidth="2" strokeLinecap="round" />
      <line x1="34" y1="44" x2="34" y2="54" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="42" y1="45.5" x2="42" y2="52.5" stroke="var(--signal-dim)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
