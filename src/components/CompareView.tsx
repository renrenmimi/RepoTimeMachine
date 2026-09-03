'use client';

import { useMemo, useState } from 'react';
import type { ApiErrorInfo } from '@/lib/client/api';
import { isCompareDirty, type CompareState } from '@/lib/client/history-controller';
import type { Commit, RepoCompare, Tag } from '@/lib/domain/types';
import { formatBytes, formatDate, formatNumber } from '@/lib/format';
import { describeCompareChanges, describeCompareRelation } from '@/lib/compare/describe';
import { areaOf, estimateLanguages } from '@/lib/stats/growth';
import { classifyPath } from '@/lib/tree/classify';
import type { Projection } from '@/lib/tree/projector';
import { colourForLanguage } from './Charts';
import { ComparePicker, type PickerChoice } from './ComparePicker';
import { FileChangeList } from './FileChangeList';
import styles from './compare.module.css';

type SubView = 'files' | 'commits' | 'stats';

type Props = {
  compare: CompareState;
  commits: Commit[];
  tags: Tag[];
  tagsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Projections at the two ends, when the tree is known there. */
  baseProjection: Projection | null;
  headProjection: Projection | null;
  onPick: (side: 'base' | 'head', choice: PickerChoice) => void;
  onSwap: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  onOpenInReplay: (index: number) => void;
};

/**
 * "What is different between these two points?"
 *
 * Choosing the ends and reading the answer are two separate steps. That is not
 * ceremony: every change of endpoint would otherwise be a request, and a
 * visitor adjusting both ends would pay for a comparison nobody wanted to see.
 */
export function CompareView({
  compare,
  commits,
  tags,
  tagsStatus,
  baseProjection,
  headProjection,
  onPick,
  onSwap,
  onSubmit,
  onRetry,
  onOpenInReplay,
}: Props) {
  const [subView, setSubView] = useState<SubView>('files');
  const dirty = isCompareDirty(compare);
  const ready = compare.status === 'ready' && compare.data;
  const sameEnds = Boolean(compare.draftBase && compare.draftBase === compare.draftHead);

  /** Why the run button is unavailable, or null when it is available. */
  const runDisabled = !compare.draftBase || !compare.draftHead
    ? 'Choose a commit or a tag for both ends first'
    : sameEnds
      ? 'Both ends are the same commit, so there is nothing to compare'
      : compare.status === 'loading'
        ? 'This comparison is being read now'
        : !dirty && compare.status === 'ready'
          ? 'This comparison is already loaded below'
          : null;

  return (
    <div className={styles.view}>
      <header className={styles.head}>
        <h2 className={styles.title}>Compare two points</h2>
        <p className={styles.subtitle}>
          The net difference between them, not the sum of every commit in between.
        </p>
      </header>

      <div className={styles.selectors}>
        <ComparePicker
          side="base"
          commits={commits}
          tags={tags}
          tagsStatus={tagsStatus}
          selected={compare.draftBase}
          selectedLabel={compare.draftBaseLabel}
          onPick={(choice) => onPick('base', choice)}
        />

        <button
          type="button"
          className={styles.swap}
          onClick={onSwap}
          disabled={!compare.draftBase || !compare.draftHead}
          aria-label="Swap the two ends of the comparison"
          title="Swap From and To"
        >
          <SwapIcon />
        </button>

        <ComparePicker
          side="head"
          commits={commits}
          tags={tags}
          tagsStatus={tagsStatus}
          selected={compare.draftHead}
          selectedLabel={compare.draftHeadLabel}
          onPick={(choice) => onPick('head', choice)}
        />

        {/* Disabled states are explained rather than left to be guessed at. */}
        <button
          type="button"
          className={styles.run}
          onClick={onSubmit}
          disabled={runDisabled !== null}
          title={runDisabled ?? 'Read the difference between these two points'}
        >
          {compare.status === 'loading' ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      {/*
       * Two ends that name the same commit need no request to answer, so this
       * comes before everything else and the button above is disabled.
       */}
      {sameEnds ? (
        <SameCommitState />
      ) : !compare.draftBase || !compare.draftHead ? (
        <div className={styles.prompt}>
          <p className={styles.promptTitle}>Choose two points</p>
          <p className={styles.promptText}>
            Pick a commit or a tag for each end above, then press Compare.
          </p>
        </div>
      ) : dirty ? (
        /*
         * A moved selector invalidates whatever is on screen, so the old result
         * is put away rather than left sitting under endpoints it does not
         * describe.
         */
        <div className={styles.prompt}>
          <p className={styles.promptTitle}>{compare.data ? 'Selection changed' : 'Ready when you are'}</p>
          <p className={styles.promptText}>
            {compare.data
              ? 'The result below was for the previous pair, so it has been put away. Press Compare to read the new one.'
              : 'Press Compare to read the difference between these two points.'}
          </p>
        </div>
      ) : compare.status === 'idle' ? (
        <div className={styles.prompt}>
          <p className={styles.promptTitle}>Ready when you are</p>
          <p className={styles.promptText}>Press Compare to read the difference between these two points.</p>
        </div>
      ) : compare.status === 'loading' ? (
        <div className={styles.state} aria-live="polite">
          <p className={styles.stateText}>Reading the difference…</p>
        </div>
      ) : compare.status === 'error' && compare.error ? (
        <CompareError error={compare.error} onRetry={onRetry} />
      ) : ready && compare.data ? (
        compare.data.status === 'identical' ? (
          <SameCommitState />
        ) : (
          <CompareResult
            data={compare.data}
            commits={commits}
            baseProjection={baseProjection}
            headProjection={headProjection}
            subView={subView}
            onSubView={setSubView}
            onOpenInReplay={onOpenInReplay}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * Two ends that name the same commit.
 *
 * Not an error and not a blank dashboard: a short statement, with the selectors
 * left above it so the fix is one click away.
 */
function SameCommitState() {
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>These are the same commit.</p>
      <p className={styles.promptText}>
        Nothing differs between a commit and itself. Change either end above to compare two different points.
      </p>
    </div>
  );
}

function CompareError({ error, onRetry }: { error: ApiErrorInfo; onRetry: () => void }) {
  return (
    <div className={styles.state} role="alert">
      <p className={styles.stateTitle}>That comparison could not be loaded</p>
      <p className={styles.stateText}>{error.message}</p>
      <div className={styles.stateActions}>
        <button type="button" className={styles.stateRetry} onClick={onRetry}>
          Try again
        </button>
      </div>
      <details className={styles.stateDetails}>
        <summary>Technical detail</summary>
        <p className={styles.stateText}>
          Error code <span className={styles.mono}>{error.code}</span>. The two selectors above still work, so
          another pair can be tried without reloading the repository.
        </p>
      </details>
    </div>
  );
}

function CompareResult({
  data,
  commits,
  baseProjection,
  headProjection,
  subView,
  onSubView,
  onOpenInReplay,
}: {
  data: RepoCompare;
  commits: Commit[];
  baseProjection: Projection | null;
  headProjection: Projection | null;
  subView: SubView;
  onSubView: (view: SubView) => void;
  onOpenInReplay: (index: number) => void;
}) {
  return (
    <div className={styles.result}>
      {/* The relation, in a sentence whose subject is the end that moved. */}
      <p className={styles.relation} data-status={data.status}>
        <span className={styles.relationSentence}>{describeCompareRelation(data)}</span>{' '}
        <span className={styles.relationChanges}>{describeCompareChanges(data)}</span>
      </p>

      <dl className={styles.metrics}>
        <div>
          <dt>Files changed</dt>
          <dd className="tabular">{formatNumber(data.changedFiles)}</dd>
        </div>
        <div>
          <dt>Lines added</dt>
          <dd className={`${styles.plus} tabular`}>+{formatNumber(data.additions)}</dd>
        </div>
        <div>
          <dt>Lines removed</dt>
          <dd className={`${styles.minus} tabular`}>&minus;{formatNumber(data.deletions)}</dd>
        </div>
      </dl>

      <div className={styles.subTabs} role="tablist" aria-label="Comparison detail">
        {(
          [
            { id: 'files' as const, label: 'File changes', count: data.changedFiles },
            { id: 'commits' as const, label: 'Commits', count: data.aheadBy },
            { id: 'stats' as const, label: 'Repository stats', count: null },
          ] satisfies { id: SubView; label: string; count: number | null }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`compare-tab-${item.id}`}
            className={styles.subTab}
            aria-selected={subView === item.id}
            aria-controls={`compare-panel-${item.id}`}
            tabIndex={subView === item.id ? 0 : -1}
            onClick={() => onSubView(item.id)}
          >
            {item.label}
            {item.count !== null ? <span className={styles.subTabCount}>({formatNumber(item.count)})</span> : null}
          </button>
        ))}
      </div>

      <div
        className={styles.subPanel}
        id={`compare-panel-${subView}`}
        role="tabpanel"
        aria-labelledby={`compare-tab-${subView}`}
      >
        {subView === 'files' ? <CompareFiles data={data} /> : null}
        {subView === 'commits' ? (
          <CompareCommits data={data} commits={commits} onOpenInReplay={onOpenInReplay} />
        ) : null}
        {subView === 'stats' ? (
          <CompareStats data={data} baseProjection={baseProjection} headProjection={headProjection} />
        ) : null}
      </div>
    </div>
  );
}

function CompareFiles({ data }: { data: RepoCompare }) {
  if (data.files.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No file differs between these two points</p>
        <p className={styles.emptyText}>
          {data.status === 'behind'
            ? 'The To end comes before the From end, and undoing the commits in between happens to leave the tree identical.'
            : 'The commits in between cancelled out, or they touched nothing that is tracked.'}
        </p>
      </div>
    );
  }

  return (
    <FileChangeList
      files={data.files}
      truncated={data.filesTruncated}
      truncationNote={
        data.filesTruncated
          ? 'This list only covers the files the loaded diffs mention, because a file tree was not available at one end.'
          : 'GitHub returns at most 300 files per comparison, so this list may be incomplete.'
      }
      resetKey={`${data.base.sha}...${data.head.sha}`}
    />
  );
}

function CompareCommits({
  data,
  commits,
  onOpenInReplay,
}: {
  data: RepoCompare;
  commits: Commit[];
  onOpenInReplay: (index: number) => void;
}) {
  // Newest first, which is how a range of work reads.
  const ordered = useMemo(() => [...data.commits].reverse(), [data.commits]);
  const indexBySha = useMemo(() => new Map(commits.map((commit) => [commit.sha, commit.index])), [commits]);

  if (data.status === 'behind') {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No commit is ahead</p>
        {/* Not "there is no difference": there is, and it runs the other way. */}
        <p className={styles.emptyText}>
          The To end comes before the From end. {formatNumber(data.behindBy)} commit
          {data.behindBy === 1 ? '' : 's'} would have to be undone to get from From to To. Swap the two ends to list
          them.
        </p>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No commits separate these two points</p>
      </div>
    );
  }

  return (
    <>
      {data.commitsTruncated ? (
        <p className={styles.note} data-tone="warning">
          Showing {formatNumber(ordered.length)} of {formatNumber(data.aheadBy)} commits. GitHub returns at most 250
          per comparison.
        </p>
      ) : null}
      {data.status === 'diverged' && data.mergeBaseSha ? (
        <p className={styles.note} data-tone="info">
          These two points have diverged. The commits below are those reachable from To but not from From, measured
          against their common ancestor <span className={styles.mono}>{data.mergeBaseSha.slice(0, 7)}</span>.
        </p>
      ) : null}
      <ul className={styles.commitList}>
        {ordered.map((commit) => {
          const replayIndex = indexBySha.get(commit.sha);
          return (
            <li key={commit.sha} className={styles.commitItem}>
              <div className={styles.commitText}>
                <p className={styles.commitSubject}>{commit.subject}</p>
                <p className={styles.commitMeta}>
                  <span className={styles.mono}>{commit.shortSha}</span>
                  <span>{commit.author.name}</span>
                  <span>{formatDate(commit.author.date)}</span>
                </p>
              </div>
              {/*
               * Explicit: choosing endpoints must never move the replay by
               * itself, so this is the only thing here that does.
               */}
              <button
                type="button"
                className={styles.commitOpen}
                disabled={replayIndex === undefined}
                title={
                  replayIndex === undefined
                    ? 'This commit is outside the loaded range, so the replay cannot open it.'
                    : 'Open this commit in the replay'
                }
                onClick={() => replayIndex !== undefined && onOpenInReplay(replayIndex)}
              >
                Open in Replay
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The two ends measured against each other.
 *
 * Everything here is counted from a real tree at that point, so a side is only
 * shown when its tree was available; a missing side says so rather than guessing.
 */
function CompareStats({
  data,
  baseProjection,
  headProjection,
}: {
  data: RepoCompare;
  baseProjection: Projection | null;
  headProjection: Projection | null;
}) {
  const left = summarise(baseProjection);
  const right = summarise(headProjection);

  if (!left && !right) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No file tree is loaded at either end</p>
        <p className={styles.emptyText}>
          These figures are counted from a real tree at each point, so there is nothing to measure yet. Opening
          either end in the replay reads the tree there.
        </p>
      </div>
    );
  }

  const rows: { label: string; left: string; right: string; delta: string | null }[] = [
    {
      label: 'Files tracked',
      left: left ? formatNumber(left.files) : 'Unknown',
      right: right ? formatNumber(right.files) : 'Unknown',
      delta: left && right ? signed(right.files - left.files) : null,
    },
    {
      label: 'Tracked bytes',
      left: left ? formatBytes(left.bytes) : 'Unknown',
      right: right ? formatBytes(right.bytes) : 'Unknown',
      delta: left && right ? signedBytes(right.bytes - left.bytes) : null,
    },
    {
      label: 'Top-level folders',
      left: left ? formatNumber(left.areas.size) : 'Unknown',
      right: right ? formatNumber(right.areas.size) : 'Unknown',
      delta: left && right ? signed(right.areas.size - left.areas.size) : null,
    },
    {
      label: 'File types seen',
      left: left ? formatNumber(left.languages.size) : 'Unknown',
      right: right ? formatNumber(right.languages.size) : 'Unknown',
      delta: left && right ? signed(right.languages.size - left.languages.size) : null,
    },
  ];

  const appeared = left && right ? [...right.areas].filter((area) => !left.areas.has(area)) : [];
  const disappeared = left && right ? [...left.areas].filter((area) => !right.areas.has(area)) : [];

  return (
    <div className={styles.stats}>
      <table className={styles.statsTable}>
        <caption className={styles.statsCaption}>
          Counted from the file tree at each point. File types come from extensions, not from reading file contents.
        </caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">
              From <span className={styles.mono}>{data.base.shortSha}</span>
            </th>
            <th scope="col">
              To <span className={styles.mono}>{data.head.shortSha}</span>
            </th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="tabular">{row.left}</td>
              <td className="tabular">{row.right}</td>
              <td
                className={`${styles.delta} tabular`}
                data-sign={row.delta?.startsWith('+') ? 'up' : row.delta?.startsWith('−') ? 'down' : undefined}
              >
                {row.delta ?? 'Unavailable'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <LanguageSides baseProjection={baseProjection} headProjection={headProjection} />

      {appeared.length > 0 ? (
        <p className={styles.areaNote}>
          <span className={styles.areaLabel}>Folders that appeared</span>
          {appeared.map((area) => (
            <span key={area} className={styles.areaChip} data-kind="added">
              {area}
            </span>
          ))}
        </p>
      ) : null}

      {disappeared.length > 0 ? (
        <p className={styles.areaNote}>
          <span className={styles.areaLabel}>Folders that went</span>
          {disappeared.map((area) => (
            <span key={area} className={styles.areaChip} data-kind="removed">
              {area}
            </span>
          ))}
        </p>
      ) : null}

      {!left || !right ? (
        <p className={styles.note} data-tone="warning">
          Only one end has a file tree loaded, so the difference column is blank rather than estimated.
        </p>
      ) : null}

      {data.mergeBaseSha ? (
        <p className={styles.note}>
          Common ancestor: <span className={styles.mono}>{data.mergeBaseSha.slice(0, 7)}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * File-type composition at both ends, on a shared colour scale.
 *
 * Same estimate the replay shows — extensions, not file contents — so the two
 * bars are directly comparable and neither is a different kind of guess.
 */
function LanguageSides({
  baseProjection,
  headProjection,
}: {
  baseProjection: Projection | null;
  headProjection: Projection | null;
}) {
  const sides = useMemo(() => {
    const base = baseProjection ? estimateLanguages(baseProjection.files) : null;
    const head = headProjection ? estimateLanguages(headProjection.files) : null;
    if (!base || !head) return null;

    // One colour per language across both bars, from the shared stable map.
    const order: string[] = [];
    for (const slice of [...head.slices, ...base.slices]) {
      if (!order.includes(slice.language)) order.push(slice.language);
    }

    const toBar = (estimate: typeof base) =>
      order
        .map((language) => {
          const slice = estimate.slices.find((item) => item.language === language);
          return {
            language,
            share: slice?.share ?? 0,
            files: slice?.files ?? 0,
            colour: colourForLanguage(language),
          };
        })
        .filter((entry) => entry.share > 0);

    return {
      order,
      base: toBar(base),
      head: toBar(head),
      baseCount: base.countedFiles,
      headCount: head.countedFiles,
    };
  }, [baseProjection, headProjection]);

  if (!sides) return null;

  return (
    <div className={styles.langBlock}>
      <p className={styles.langTitle}>
        File-type mix
        <span className={styles.langEstimate}>estimate from extensions</span>
      </p>

      {(['base', 'head'] as const).map((side) => (
        <div className={styles.langRow} key={side}>
          <span className={styles.langSide}>{side === 'base' ? 'From' : 'To'}</span>
          <span
            className={styles.langBar}
            role="img"
            aria-label={`${side === 'base' ? 'From' : 'To'}: ${sides[side]
              .map((entry) => `${entry.language} ${entry.files}`)
              .join(', ')}`}
          >
            {sides[side].map((entry) => (
              <span
                key={entry.language}
                className={styles.langSegment}
                style={{ width: `${Math.max(entry.share * 100, 1.2)}%`, background: entry.colour }}
                title={`${entry.language}: ${formatNumber(entry.files)} files`}
              />
            ))}
          </span>
          <span className={`${styles.langCount} tabular`}>{formatNumber(sides[`${side}Count`])}</span>
        </div>
      ))}

      <ul className={styles.langLegend}>
        {sides.order.slice(0, 8).map((language) => (
          <li key={language}>
            <span className={styles.langDot} style={{ background: colourForLanguage(language) }} aria-hidden="true" />
            {language}
          </li>
        ))}
      </ul>
    </div>
  );
}

type SideSummary = { files: number; bytes: number; areas: Set<string>; languages: Set<string> };

function summarise(projection: Projection | null): SideSummary | null {
  if (!projection || projection.files.size === 0) return null;
  const areas = new Set<string>();
  const languages = new Set<string>();
  let bytes = 0;
  for (const [path, state] of projection.files) {
    areas.add(areaOf(path));
    const language = classifyPath(path).language;
    if (language) languages.add(language);
    if (typeof state.size === 'number') bytes += state.size;
  }
  return { files: projection.files.size, bytes, areas, languages };
}

const signed = (value: number): string =>
  value === 0 ? '0' : value > 0 ? `+${formatNumber(value)}` : `−${formatNumber(Math.abs(value))}`;

const signedBytes = (value: number): string =>
  value === 0 ? '0' : value > 0 ? `+${formatBytes(value)}` : `−${formatBytes(Math.abs(value))}`;

function SwapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 4.5h9L8.5 2M12 9.5H3l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
