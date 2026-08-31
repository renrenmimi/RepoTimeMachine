'use client';

import { useMemo } from 'react';
import type { ApiErrorInfo } from '@/lib/client/api';
import type { CompareState } from '@/lib/client/history-controller';
import type { Commit, CompareEndpoint, RepoCompare, Tag } from '@/lib/domain/types';
import { formatBytes, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { areaOf, estimateLanguages } from '@/lib/stats/growth';
import { classifyPath } from '@/lib/tree/classify';
import { CATEGORY_COLOURS } from './Charts';
import type { Projection } from '@/lib/tree/projector';
import { ComparePicker, type PickerChoice } from './ComparePicker';
import { FileChangeList } from './FileChangeList';
import styles from './compare.module.css';
import shell from './shell.module.css';

type Props = {
  compare: CompareState;
  commits: Commit[];
  tags: Tag[];
  /** Projections at the two ends, when the tree is known there. */
  baseProjection: Projection | null;
  headProjection: Projection | null;
  onPick: (side: 'base' | 'head', choice: PickerChoice) => void;
  onSwap: () => void;
  onClose: () => void;
  onSeek: (index: number) => void;
};

export function ComparePanel({
  compare,
  commits,
  tags,
  baseProjection,
  headProjection,
  onPick,
  onSwap,
  onClose,
  onSeek,
}: Props) {
  return (
    <div className={styles.panel}>
      <ComparePanelHeader compare={compare} commits={commits} tags={tags} onPick={onPick} onSwap={onSwap} onClose={onClose} />

      {compare.status === 'loading' ? <CompareLoading /> : null}
      {compare.status === 'error' && compare.error ? <CompareError error={compare.error} /> : null}

      {compare.status === 'ready' && compare.data ? (
        <CompareBody
          data={compare.data}
          commits={commits}
          baseProjection={baseProjection}
          headProjection={headProjection}
          onSeek={onSeek}
        />
      ) : null}
    </div>
  );
}

function ComparePanelHeader({
  compare,
  commits,
  tags,
  onPick,
  onSwap,
  onClose,
}: Pick<Props, 'compare' | 'commits' | 'tags' | 'onPick' | 'onSwap' | 'onClose'>) {
  return (
    <header className={styles.head}>
      <div className={styles.headTitle}>
        <h2 className={styles.title}>Compare two points</h2>
        <p className={styles.subtitle}>
          The net difference between them, not the sum of every commit in between.
        </p>
      </div>

      <div className={styles.pickers}>
        <ComparePicker
          side="base"
          commits={commits}
          tags={tags}
          selected={compare.base}
          selectedLabel={compare.baseLabel ?? compare.data?.base.tagName ?? null}
          onPick={(choice) => onPick('base', choice)}
        />

        <button
          type="button"
          className={styles.swap}
          onClick={onSwap}
          disabled={!compare.base || !compare.head}
          title="Swap the two ends"
          aria-label="Swap the two ends of the comparison"
        >
          <SwapIcon />
        </button>

        <ComparePicker
          side="head"
          commits={commits}
          tags={tags}
          selected={compare.head}
          selectedLabel={compare.headLabel ?? compare.data?.head.tagName ?? null}
          onPick={(choice) => onPick('head', choice)}
        />
      </div>

      <button type="button" className={styles.close} onClick={onClose}>
        Back to the timeline
      </button>
    </header>
  );
}

function CompareLoading() {
  return (
    <div className={styles.state} aria-live="polite">
      <p className={styles.stateText}>Reading the difference…</p>
    </div>
  );
}

function CompareError({ error }: { error: ApiErrorInfo }) {
  return (
    <div className={styles.state} role="alert">
      <p className={styles.stateCode}>{error.code}</p>
      <p className={styles.stateText}>{error.message}</p>
    </div>
  );
}

function CompareBody({
  data,
  commits,
  baseProjection,
  headProjection,
  onSeek,
}: {
  data: RepoCompare;
  commits: Commit[];
  baseProjection: Projection | null;
  headProjection: Projection | null;
  onSeek: (index: number) => void;
}) {
  return (
    <>
      <CompareSummary data={data} />

      <div className={styles.grid}>
        <section className={`${shell.panel} ${styles.column}`} aria-labelledby="compare-files">
          <header className={shell.panelHead}>
            <h3 className={shell.panelTitle} id="compare-files">
              Net file changes
            </h3>
            <span className={shell.panelHeadSpacer} />
            <span className={`${styles.count} tabular`}>{formatNumber(data.changedFiles)}</span>
          </header>
          <div className={shell.panelBody}>
            {data.status === 'identical' ? (
              <p className={styles.empty}>These two points are the same commit, so nothing differs.</p>
            ) : data.files.length === 0 ? (
              <p className={styles.empty}>No file differs between these two points.</p>
            ) : (
              <FileChangeList
                files={data.files}
                truncated={data.filesTruncated}
                truncationNote={
                  data.filesTruncated
                    ? 'This list only covers the files the loaded diffs mention, because a file tree was not available at one end.'
                    : 'GitHub returns at most 300 files per comparison, so this list may be incomplete.'
                }
              />
            )}
          </div>
        </section>

        <section className={`${shell.panel} ${styles.column}`} aria-labelledby="compare-commits">
          <header className={shell.panelHead}>
            <h3 className={shell.panelTitle} id="compare-commits">
              Commits in between
            </h3>
            <span className={shell.panelHeadSpacer} />
            <span className={`${styles.count} tabular`}>{formatNumber(data.aheadBy)}</span>
          </header>
          <div className={shell.panelBody}>
            <CompareCommits data={data} commits={commits} onSeek={onSeek} />
          </div>
        </section>

        <section className={`${shell.panel} ${styles.column}`} aria-labelledby="compare-sides">
          <header className={shell.panelHead}>
            <h3 className={shell.panelTitle} id="compare-sides">
              Side by side
            </h3>
          </header>
          <div className={shell.panelBody}>
            <SideBySide data={data} baseProjection={baseProjection} headProjection={headProjection} />
          </div>
        </section>
      </div>
    </>
  );
}

const STATUS_WORDS: Record<RepoCompare['status'], string> = {
  identical: 'identical',
  ahead: 'ahead',
  behind: 'behind',
  diverged: 'diverged',
};

function CompareSummary({ data }: { data: RepoCompare }) {
  return (
    <div className={styles.summary}>
      <div className={styles.ends}>
        <EndpointCard endpoint={data.base} role="base" />
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <EndpointCard endpoint={data.head} role="head" />
      </div>

      <dl className={styles.stats}>
        <div>
          <dt>relation</dt>
          <dd className={styles.statusValue} data-status={data.status}>
            {STATUS_WORDS[data.status]}
          </dd>
        </div>
        <div>
          <dt>ahead</dt>
          <dd className="tabular">{formatNumber(data.aheadBy)}</dd>
        </div>
        <div>
          <dt>behind</dt>
          <dd className="tabular">{formatNumber(data.behindBy)}</dd>
        </div>
        <div>
          <dt>files</dt>
          <dd className="tabular">{formatNumber(data.changedFiles)}</dd>
        </div>
        <div>
          <dt>lines</dt>
          <dd className="tabular">
            <span className={styles.plus}>+{formatNumber(data.additions)}</span>{' '}
            <span className={styles.minus}>&minus;{formatNumber(data.deletions)}</span>
          </dd>
        </div>
      </dl>

      <p className="visually-hidden">
        {data.base.shortSha} is {STATUS_WORDS[data.status]} of {data.head.shortSha}:{' '}
        {formatNumber(data.aheadBy)} commits ahead, {formatNumber(data.behindBy)} behind,{' '}
        {formatNumber(data.changedFiles)} files changed, {formatNumber(data.additions)} lines added and{' '}
        {formatNumber(data.deletions)} removed.
      </p>

      {data.htmlUrl ? (
        <a className={styles.externalLink} href={data.htmlUrl} target="_blank" rel="noreferrer noopener">
          Open this comparison on GitHub
        </a>
      ) : null}
    </div>
  );
}

function EndpointCard({ endpoint, role }: { endpoint: CompareEndpoint; role: 'base' | 'head' }) {
  return (
    <div className={styles.endpoint} data-role={role}>
      <p className={styles.endpointRole}>{role}</p>
      <p className={styles.endpointName}>
        {endpoint.tagName ? (
          <span className={styles.tagBadge}>
            <TagIcon />
            {endpoint.tagName}
          </span>
        ) : null}
        <span className={styles.mono}>{endpoint.shortSha}</span>
      </p>
      <p className={styles.endpointSubject}>{endpoint.subject || <span className={styles.unknown}>subject unknown</span>}</p>
      <p className={styles.endpointMeta}>
        {endpoint.authorName ? <span>{endpoint.authorName}</span> : null}
        {endpoint.date ? <time dateTime={endpoint.date}>{formatDateTime(endpoint.date)}</time> : null}
      </p>
      {endpoint.htmlUrl ? (
        <a className={styles.endpointLink} href={endpoint.htmlUrl} target="_blank" rel="noreferrer noopener">
          View commit
        </a>
      ) : null}
    </div>
  );
}

function CompareCommits({
  data,
  commits,
  onSeek,
}: {
  data: RepoCompare;
  commits: Commit[];
  onSeek: (index: number) => void;
}) {
  // Newest first, which is how a range of work reads.
  const ordered = useMemo(() => [...data.commits].reverse(), [data.commits]);
  const indexBySha = useMemo(() => new Map(commits.map((commit) => [commit.sha, commit.index])), [commits]);

  if (data.status === 'behind') {
    return (
      <p className={styles.empty}>
        Head comes before base, so no commit is ahead. {formatNumber(data.behindBy)} commit
        {data.behindBy === 1 ? '' : 's'} would have to be undone to get from base to head.
      </p>
    );
  }

  if (ordered.length === 0) {
    return <p className={styles.empty}>No commits separate these two points.</p>;
  }

  return (
    <>
      {data.commitsTruncated ? (
        <p className={styles.note}>
          Showing {formatNumber(ordered.length)} of {formatNumber(data.aheadBy)} commits. GitHub returns at most 250
          per comparison.
        </p>
      ) : null}
      <ul className={styles.commitList}>
        {ordered.map((commit) => {
          const timelineIndex = indexBySha.get(commit.sha);
          return (
            <li key={commit.sha}>
              <button
                type="button"
                className={styles.commitItem}
                disabled={timelineIndex === undefined}
                title={
                  timelineIndex === undefined
                    ? 'This commit is outside the loaded range, so the timeline cannot open it.'
                    : 'Open this commit on the timeline'
                }
                onClick={() => timelineIndex !== undefined && onSeek(timelineIndex)}
              >
                <span className={styles.commitSubject}>{commit.subject}</span>
                <span className={styles.commitMeta}>
                  <span className={styles.mono}>{commit.shortSha}</span>
                  <span>{commit.author.name}</span>
                  <span>{formatDate(commit.author.date)}</span>
                </span>
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
function SideBySide({
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
      <p className={styles.empty}>
        A file tree is not loaded at either end yet, so there is nothing to measure side by side.
      </p>
    );
  }

  const rows: { label: string; left: string; right: string; delta: string | null }[] = [
    {
      label: 'files',
      left: left ? formatNumber(left.files) : '—',
      right: right ? formatNumber(right.files) : '—',
      delta: left && right ? signed(right.files - left.files) : null,
    },
    {
      label: 'tracked bytes',
      left: left ? formatBytes(left.bytes) : '—',
      right: right ? formatBytes(right.bytes) : '—',
      delta: left && right ? signedBytes(right.bytes - left.bytes) : null,
    },
    {
      label: 'top-level folders',
      left: left ? formatNumber(left.areas.size) : '—',
      right: right ? formatNumber(right.areas.size) : '—',
      delta: left && right ? signed(right.areas.size - left.areas.size) : null,
    },
    {
      label: 'languages seen',
      left: left ? formatNumber(left.languages.size) : '—',
      right: right ? formatNumber(right.languages.size) : '—',
      delta: left && right ? signed(right.languages.size - left.languages.size) : null,
    },
  ];

  const appeared = left && right ? [...right.areas].filter((area) => !left.areas.has(area)) : [];
  const disappeared = left && right ? [...left.areas].filter((area) => !right.areas.has(area)) : [];

  return (
    <div className={styles.sides}>
      <table className={styles.sideTable}>
        <caption className="visually-hidden">
          The state of the repository at each end of the comparison, counted from the file tree there.
        </caption>
        <thead>
          <tr>
            <th scope="col">&nbsp;</th>
            <th scope="col">base</th>
            <th scope="col">head</th>
            <th scope="col">change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="tabular">{row.left}</td>
              <td className="tabular">{row.right}</td>
              <td className={`${styles.delta} tabular`} data-sign={row.delta?.startsWith('+') ? 'up' : row.delta?.startsWith('−') ? 'down' : undefined}>
                {row.delta ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <LanguageSides baseProjection={baseProjection} headProjection={headProjection} />

      {appeared.length > 0 ? (
        <p className={styles.areaNote}>
          <span className={styles.areaLabel}>appeared</span>
          {appeared.map((area) => (
            <span key={area} className={styles.areaChip} data-kind="added">
              {area}
            </span>
          ))}
        </p>
      ) : null}

      {disappeared.length > 0 ? (
        <p className={styles.areaNote}>
          <span className={styles.areaLabel}>gone</span>
          {disappeared.map((area) => (
            <span key={area} className={styles.areaChip} data-kind="removed">
              {area}
            </span>
          ))}
        </p>
      ) : null}

      {!left || !right ? (
        <p className={styles.note}>
          Only one end has a file tree loaded, so the comparison column is blank rather than estimated.
        </p>
      ) : null}

      <p className={styles.note}>
        Counted from the file tree at each point. Language counts come from file extensions, not file contents.
      </p>

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
 * Same estimate the timeline shows — extensions, not file contents — so the two
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

    // One colour per language across both bars, ordered by the larger end.
    const order: string[] = [];
    for (const slice of [...head.slices, ...base.slices]) {
      if (!order.includes(slice.language)) order.push(slice.language);
    }
    const colourOf = new Map(order.map((language, index) => [language, CATEGORY_COLOURS[index % CATEGORY_COLOURS.length]]));

    const toBar = (estimate: typeof base) =>
      order
        .map((language) => {
          const slice = estimate.slices.find((item) => item.language === language);
          return { language, share: slice?.share ?? 0, files: slice?.files ?? 0, colour: colourOf.get(language)! };
        })
        .filter((entry) => entry.share > 0);

    return { order, colourOf, base: toBar(base), head: toBar(head), baseCount: base.countedFiles, headCount: head.countedFiles };
  }, [baseProjection, headProjection]);

  if (!sides) return null;

  return (
    <div className={styles.langBlock}>
      <p className={styles.langTitle}>
        File-type mix
        <span className={styles.langEstimate}>estimate</span>
      </p>

      {(['base', 'head'] as const).map((side) => (
        <div className={styles.langRow} key={side}>
          <span className={styles.langSide}>{side}</span>
          <span
            className={styles.langBar}
            role="img"
            aria-label={`${side}: ${sides[side].map((entry) => `${entry.language} ${entry.files}`).join(', ')}`}
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
            <span className={styles.langDot} style={{ background: sides.colourOf.get(language) }} aria-hidden="true" />
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

const signed = (value: number): string => (value === 0 ? '0' : value > 0 ? `+${formatNumber(value)}` : `−${formatNumber(Math.abs(value))}`);

const signedBytes = (value: number): string =>
  value === 0 ? '0' : value > 0 ? `+${formatBytes(value)}` : `−${formatBytes(Math.abs(value))}`;

function SwapIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 4.5h9L8.5 2M12 9.5H3l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M5.2 1H9v3.8L4.8 9 1 5.2z" strokeLinejoin="round" />
      <circle cx="7" cy="3" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
