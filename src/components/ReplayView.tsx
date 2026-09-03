'use client';

import { useMemo, useState } from 'react';
import type { Commit, CommitDetail, Tag } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import type { PlaybackState, Speed } from '@/lib/playback/machine';
import type { Projection } from '@/lib/tree/projector';
import { formatDateTime, formatGap, formatNumber } from '@/lib/format';
import { ChangesPanel } from './ChangesPanel';
import type { OpenedDiff } from './FileChangeList';
import { HistoryColumn } from './HistoryColumn';
import { Overlay } from './Overlay';
import { Transport } from './Transport';
import { TreePanel, type TreeViewState } from './TreePanel';
import { useMediaQuery } from './hooks';
import styles from './replay.module.css';

export type SubView = 'repository' | 'changes';

type Props = {
  commits: Commit[];
  playback: PlaybackState;
  currentCommit: Commit | null;
  previousCommit: Commit | null;
  detail: CommitDetail | null;
  detailPending: boolean;
  details: ReadonlyMap<string, CommitDetail>;
  projection: Projection;
  /** Milestones on the selected commit only. */
  commitMilestones: Milestone[];
  milestones: Milestone[];
  tags: Tag[];
  totalCommits: number | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  canLoadOlder: boolean;
  snapshotLoading: boolean;
  rangeLabel: string;
  version: number;
  reducedMotion: boolean;
  onSeek: (index: number, options?: { push?: boolean }) => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onLatest: () => void;
  onSpeed: (speed: Speed) => void;
  onLoadOlder: () => void;
  onPause: () => void;
  onShowMilestones: () => void;
  /*
   * Held by the shell rather than here, because this component unmounts on a
   * view change and every one of these is something the visitor chose.
   */
  subView: SubView;
  onSubView: (next: SubView) => void;
  diffFocus: { path: string } | null;
  onDiffFocus: (next: { path: string } | null) => void;
  openedDiff: OpenedDiff | null;
  onOpenedDiff: (next: OpenedDiff | null) => void;
  treeView: TreeViewState;
  onTreeView: (next: TreeViewState) => void;
};

/**
 * "What did this repository look like here, and what did this commit change?"
 *
 * Two columns: where you are in the history, and the repository at that point.
 * The commit's identity and the player sit above the content they describe, and
 * both sub-views share them — so switching between the tree and the diff never
 * moves the heading or loses the place.
 */
export function ReplayView(props: Props) {
  const {
    commits,
    playback,
    currentCommit,
    previousCommit,
    detail,
    detailPending,
    details,
    projection,
    commitMilestones,
    milestones,
    tags,
    totalCommits,
    hasOlder,
    loadingOlder,
    canLoadOlder,
    snapshotLoading,
    rangeLabel,
    version,
    reducedMotion,
    onSeek,
    onLoadOlder,
    onPause,
    onShowMilestones,
    subView,
    onSubView,
    diffFocus,
    onDiffFocus,
    openedDiff,
    onOpenedDiff,
    treeView,
    onTreeView,
  } = props;

  const narrow = useMediaQuery('(max-width: 899px)');

  /*
   * The drawer only exists on a narrow screen, so its open state is stored
   * alongside the width it belongs to and reset when that changes. React's
   * documented way to adjust state from a changed input, rather than an effect
   * that fires a second render after every resize.
   */
  const [drawer, setDrawer] = useState({ narrow, open: false });
  if (drawer.narrow !== narrow) setDrawer({ narrow, open: false });
  const historyOpen = drawer.narrow === narrow && drawer.open;
  const setHistoryOpen = (open: boolean) => setDrawer({ narrow, open });

  const historyColumn = (showHeading: boolean) => (
    <HistoryColumn
      showHeading={showHeading}
      commits={commits}
      currentIndex={playback.index}
      milestones={milestones}
      tags={tags}
      totalCommits={totalCommits}
      hasOlder={hasOlder}
      loadingOlder={loadingOlder}
      canLoadOlder={canLoadOlder}
      onSeek={(index) => {
        onSeek(index, { push: true });
        setHistoryOpen(false);
      }}
      onLoadOlder={onLoadOlder}
    />
  );

  /**
   * Opening a diff from the file tree.
   *
   * The commit does not change — only which sub-view is showing it — and
   * playback stops, because the visitor is about to read something specific.
   */
  const openDiff = (path: string) => {
    onPause();
    onSubView('changes');
    onDiffFocus({ path });
  };

  const changedCount = detail?.changedFiles ?? projection.changes.size;

  return (
    <div className={styles.replay}>
      {narrow ? (
        <>
          <div className={styles.historyBar}>
            <button type="button" className={styles.historyOpen} onClick={() => setHistoryOpen(true)}>
              History
              <span className={styles.historyOpenCount}>{rangeLabel}</span>
            </button>
          </div>
          {historyOpen ? (
            <Overlay title="History" variant="drawer" onClose={() => setHistoryOpen(false)}>
              {historyColumn(false)}
            </Overlay>
          ) : null}
        </>
      ) : (
        <aside className={styles.historyColumn} aria-label="Commit history">
          {historyColumn(true)}
        </aside>
      )}

      <div className={styles.main}>
        <header className={styles.commitHead}>
          <p className={styles.position} id="replay-position">
            <span className="tabular">
              {commits.length === 0
                ? 'No commits loaded'
                : `Commit ${formatNumber(playback.index + 1)} of ${formatNumber(commits.length)}`}
            </span>
            {currentCommit ? (
              <>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                <time dateTime={currentCommit.author.date}>{formatDateTime(currentCommit.author.date)}</time>
              </>
            ) : null}
          </p>

          <h2 className={styles.subject} id="selected-commit-subject">
            {currentCommit ? currentCommit.subject : 'No commit selected'}
          </h2>

          {currentCommit ? (
            <CommitMeta
              commit={currentCommit}
              previous={previousCommit}
              detail={detail}
              detailPending={detailPending}
              onOpen={onPause}
            />
          ) : null}

          {commitMilestones.length > 0 ? (
            <MilestoneLine milestones={commitMilestones} onShowAll={onShowMilestones} onOpen={onPause} />
          ) : null}
        </header>

        <div className={styles.transportSlot}>
          <Transport
            playback={playback}
            commits={commits}
            milestones={milestones}
            rangeLabel={rangeLabel}
            disabled={false}
            onPlayPause={props.onPlayPause}
            onNext={props.onNext}
            onPrevious={props.onPrevious}
            onSeek={(index) => onSeek(index)}
            onSpeed={props.onSpeed}
            onLatest={props.onLatest}
          />
        </div>

        <div className={styles.subTabs} role="tablist" aria-label="What to show for this commit">
          <button
            type="button"
            role="tab"
            id="subtab-repository"
            className={styles.subTab}
            aria-selected={subView === 'repository'}
            aria-controls="subpanel-repository"
            tabIndex={subView === 'repository' ? 0 : -1}
            onClick={() => onSubView('repository')}
          >
            Repository
          </button>
          <button
            type="button"
            role="tab"
            id="subtab-changes"
            className={styles.subTab}
            aria-selected={subView === 'changes'}
            aria-controls="subpanel-changes"
            tabIndex={subView === 'changes' ? 0 : -1}
            onClick={() => {
              onSubView('changes');
              onDiffFocus(null);
            }}
          >
            Changes
            <span className={styles.subTabCount}>({formatNumber(changedCount)})</span>
          </button>
        </div>

        {subView === 'repository' ? (
          <div
            className={styles.subPanel}
            id="subpanel-repository"
            role="tabpanel"
            aria-labelledby="subtab-repository"
          >
            <TreePanel
              projection={projection}
              commits={commits}
              currentIndex={playback.index}
              details={details}
              loading={snapshotLoading}
              version={version}
              view={treeView}
              onView={onTreeView}
              onSeek={(index) => onSeek(index, { push: true })}
              onOpenDiff={openDiff}
            />
          </div>
        ) : (
          <div className={styles.subPanel} id="subpanel-changes" role="tabpanel" aria-labelledby="subtab-changes">
            <ChangesPanel
              detail={detail}
              pending={detailPending}
              playing={playback.playing && !reducedMotion}
              focus={diffFocus}
              onOpenPatch={onPause}
              opened={openedDiff}
              onOpened={onOpenedDiff}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Author, sha, the source link where one exists, and the long body on request. */
function CommitMeta({
  commit,
  previous,
  detail,
  detailPending,
  onOpen,
}: {
  commit: Commit;
  previous: Commit | null;
  detail: CommitDetail | null;
  detailPending: boolean;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gap = previous ? formatGap(previous.author.date, commit.author.date) : null;

  return (
    <>
      <p className={styles.meta}>
        <span className={styles.metaAuthor}>{commit.author.name}</span>
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
        {/* A built-in commit has no repository to open, so the sha is plain text. */}
        {commit.htmlUrl ? (
          <a className={styles.shaLink} href={commit.htmlUrl} target="_blank" rel="noreferrer noopener">
            <span className={styles.mono}>{commit.shortSha}</span>
            <ExternalIcon />
          </a>
        ) : (
          <span
            className={`${styles.shaPlain} ${styles.mono}`}
            title="Built-in demo commit; there is no repository to open."
          >
            {commit.shortSha}
          </span>
        )}
        {gap ? (
          <>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className={styles.metaGap}>{gap}</span>
          </>
        ) : null}
        {commit.body ? (
          <button
            type="button"
            className={styles.metaToggle}
            aria-expanded={open}
            onClick={() => {
              if (!open) onOpen();
              setOpen((value) => !value);
            }}
          >
            {open ? 'Hide commit details' : 'Commit details'}
          </button>
        ) : null}
      </p>

      {open && commit.body ? <CommitBody body={commit.body} /> : null}

      {/*
       * One line of arithmetic, from this commit's own diff. Not a summary of
       * what the commit "achieved" — nothing here is generated.
       */}
      <p className={styles.summary}>
        {detail ? (
          <>
            <span className="tabular">
              {formatNumber(detail.changedFiles)} file{detail.changedFiles === 1 ? '' : 's'} changed
            </span>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <span className={`${styles.plus} tabular`}>+{formatNumber(detail.additions)}</span>
            <span className={styles.summarySlash} aria-hidden="true">
              /
            </span>
            <span className={`${styles.minus} tabular`}>&minus;{formatNumber(detail.deletions)}</span>
            <span className={styles.summaryUnit}>lines</span>
          </>
        ) : (
          <span className={styles.summaryPending}>
            {detailPending ? 'Loading the file changes for this commit…' : 'File changes for this commit not loaded'}
          </span>
        )}
      </p>
    </>
  );
}

const BODY_PREVIEW_LINES = 5;
const BODY_MAX_CHARS = 4000;

/** Long commit bodies stay collapsed so the file list keeps the space. */
function CommitBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}…` : body;
  const lines = text.split('\n');
  const long = lines.length > BODY_PREVIEW_LINES;
  const shown = expanded || !long ? text : lines.slice(0, BODY_PREVIEW_LINES).join('\n');

  return (
    <div className={styles.bodyWrap}>
      <p className={styles.body}>{shown}</p>
      {long ? (
        <button type="button" className={styles.bodyToggle} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Milestones on this commit, as one line.
 *
 * Several rules commonly fire on the same commit, so this counts *milestones*
 * and says so — it is not a count of commits or of phases. The evidence expands
 * here; the full list lives in Insights.
 */
function MilestoneLine({
  milestones,
  onShowAll,
  onOpen,
}: {
  milestones: Milestone[];
  onShowAll: () => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const approximate = milestones.some((milestone) => milestone.confidence === 'window');

  const labels = useMemo(() => milestones.map((milestone) => milestone.label).join(' · '), [milestones]);

  return (
    <div className={styles.milestones}>
      <p className={styles.milestoneLine}>
        <span className={styles.milestoneCount} data-approximate={approximate || undefined}>
          {milestones.length} detected milestone{milestones.length === 1 ? '' : 's'}
        </span>
        <span className={styles.milestoneLabels} title={labels}>
          {labels}
        </span>
        <button
          type="button"
          className={styles.milestoneToggle}
          aria-expanded={open}
          onClick={() => {
            if (!open) onOpen();
            setOpen((value) => !value);
          }}
        >
          {open ? 'Hide evidence' : 'Evidence'}
        </button>
      </p>

      {open ? (
        <div className={styles.milestoneDetail}>
          <ul className={styles.milestoneList}>
            {milestones.map((milestone) => (
              <li key={milestone.id} className={styles.milestoneItem}>
                <p className={styles.milestoneItemLabel}>
                  {milestone.label}
                  <ConfidenceTag milestone={milestone} />
                </p>
                <p className={styles.milestoneItemEvidence}>{milestone.evidence}</p>
                <p className={styles.milestoneItemRule}>Rule: {milestone.rule}</p>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.milestoneAll} onClick={onShowAll}>
            All milestones in Insights
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConfidenceTag({ milestone }: { milestone: Milestone }) {
  if (milestone.confidence === 'window' && milestone.window) {
    return (
      <span className={styles.confidence} data-level="window">
        narrowed to commits {milestone.window.fromIndex + 1}–{milestone.window.toIndex + 1}
      </span>
    );
  }
  if (milestone.confidence === 'probed') {
    return (
      <span className={styles.confidence} data-level="probed">
        confirmed by path history
      </span>
    );
  }
  return null;
}

function ExternalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3.5 1.5H1.5v7h7v-2" strokeLinecap="round" />
      <path d="M6 1.5h2.5V4M8.5 1.5 4.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
