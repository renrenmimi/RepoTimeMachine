'use client';

import { useMemo } from 'react';
import type { Commit, RepoMeta } from '@/lib/domain/types';
import type { DensifyState } from '@/lib/client/history-controller';
import type { Milestone } from '@/lib/milestones/detect';
import type { ActivityMap, GrowthSeries } from '@/lib/stats/growth';
import { estimateLanguages } from '@/lib/stats/growth';
import type { Projection } from '@/lib/tree/projector';
import { formatDate, formatNumber } from '@/lib/format';
import { describeLoadedRange } from '@/lib/range';
import { ActivityGrid, GrowthChart, LanguageBar } from './Charts';
import { MAX_COMMITS, OLDER_STEP } from './States';
import styles from './insights.module.css';

type Props = {
  meta: RepoMeta | null;
  commits: Commit[];
  currentIndex: number;
  projection: Projection;
  growth: GrowthSeries | null;
  activity: ActivityMap | null;
  milestones: Milestone[];
  densify: DensifyState;
  totalCommits: number | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  canLoadOlder: boolean;
  onInspect: (index: number) => void;
  onSeek: (index: number) => void;
  onLoadOlder: () => void;
};

/**
 * "How did the structure and the size change across what is loaded?"
 *
 * A page, read downwards, at a normal width — not a column of tiles. Every
 * figure here describes the loaded range, which the summary at the top states
 * before any of the numbers appear.
 */
export function InsightsView(props: Props) {
  const {
    commits,
    currentIndex,
    projection,
    growth,
    activity,
    milestones,
    densify,
    totalCommits,
    hasOlder,
    loadingOlder,
    canLoadOlder,
    onInspect,
    onSeek,
    onLoadOlder,
  } = props;

  const languages = useMemo(() => estimateLanguages(projection.files), [projection.files]);
  const first = commits[0];
  const last = commits[commits.length - 1];

  return (
    <div className={styles.view}>
      <div className={styles.inner}>
        <section className={styles.scope} aria-labelledby="insights-scope">
          <h2 className={styles.scopeTitle} id="insights-scope">
            {describeLoadedRange(commits.length, totalCommits)}
          </h2>
          <p className={styles.scopeText}>
            {first && last ? (
              <>
                {formatDate(first.author.date)} to {formatDate(last.author.date)}.{' '}
              </>
            ) : null}
            {/* Said before any figure below it: this is a window, not a history. */}
            {totalCommits !== null && commits.length < totalCommits
              ? `Everything on this page is measured over these ${formatNumber(commits.length)} commits only. The earliest of them is not the repository's first commit.`
              : 'Everything on this page is measured over the commits listed in the replay.'}
          </p>

          <dl className={styles.scopeFacts}>
            <div>
              <dt>Commits in range</dt>
              <dd className="tabular">{formatNumber(commits.length)}</dd>
            </div>
            <div>
              <dt>Diffs loaded</dt>
              <dd className="tabular">
                {formatNumber(growth?.knownCommits ?? 0)} of {formatNumber(commits.length)}
              </dd>
            </div>
            <div>
              <dt>Files at this commit</dt>
              <dd className="tabular">{formatNumber(projection.files.size)}</dd>
            </div>
          </dl>

          {densify.limitReason ? (
            <p className={styles.limit} data-tone="warning">
              {densify.limitReason}
            </p>
          ) : null}

          {hasOlder ? (
            <div className={styles.scopeAction}>
              <button
                type="button"
                className={styles.loadOlder}
                onClick={onLoadOlder}
                disabled={loadingOlder || !canLoadOlder}
              >
                {loadingOlder
                  ? 'Loading…'
                  : canLoadOlder
                    ? `Load ${formatNumber(OLDER_STEP)} older commits`
                    : 'Session limit reached'}
              </button>
              <p className={styles.scopeNote}>
                {canLoadOlder
                  ? 'Loading more extends every figure on this page backwards.'
                  : `This session loads at most ${formatNumber(MAX_COMMITS)} commits.`}
              </p>
            </div>
          ) : null}
        </section>

        <section className={styles.block} aria-labelledby="insights-growth">
          <h2 className={styles.blockTitle} id="insights-growth">
            Growth
          </h2>
          <p className={styles.blockNote}>
            Files present in the tree above, lines added and removed per commit below. Click the chart, or use the
            table beneath it, to move the replay.
          </p>
          {growth ? (
            <GrowthChart
              series={growth}
              currentIndex={currentIndex}
              totalCommits={totalCommits ?? commits.length}
              onSeek={onSeek}
            />
          ) : (
            <p className={styles.empty}>Waiting for history.</p>
          )}
        </section>

        <section className={styles.block} aria-labelledby="insights-milestones">
          <h2 className={styles.blockTitle} id="insights-milestones">
            Milestones
            <span className={styles.blockCount}>{formatNumber(milestones.length)}</span>
          </h2>
          <MilestoneList milestones={milestones} commits={commits} currentIndex={currentIndex} onInspect={onInspect} />
        </section>

        <section className={styles.block} aria-labelledby="insights-types">
          <h2 className={styles.blockTitle} id="insights-types">
            File types at commit {formatNumber(Math.min(currentIndex + 1, commits.length))}
            <span className={styles.estimate}>estimate</span>
          </h2>
          <p className={styles.blockNote}>
            Counted by file extension for the tree at the commit currently selected in the replay.
          </p>
          <LanguageBar estimate={languages} />
        </section>

        <section className={styles.block} aria-labelledby="insights-activity">
          <h2 className={styles.blockTitle} id="insights-activity">
            Where work happened
          </h2>
          {activity ? (
            <ActivityGrid map={activity} onSeek={onSeek} />
          ) : (
            <p className={styles.empty}>Waiting for diffs.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The detected milestones, grouped by commit.
 *
 * Grouping matters for honesty as much as for layout: several rules commonly
 * fire on one commit, so a flat list of fifteen entries would read as fifteen
 * moments in the project's life when it might be four.
 */
function MilestoneList({
  milestones,
  commits,
  currentIndex,
  onInspect,
}: {
  milestones: Milestone[];
  commits: Commit[];
  currentIndex: number;
  onInspect: (index: number) => void;
}) {
  const groups = useMemo(() => {
    const byIndex = new Map<number, Milestone[]>();
    for (const milestone of milestones) {
      const list = byIndex.get(milestone.commitIndex) ?? [];
      list.push(milestone);
      byIndex.set(milestone.commitIndex, list);
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  }, [milestones]);

  if (groups.length === 0) {
    return (
      <p className={styles.empty}>
        No milestones detected yet. Rules that need commit diffs fire as those diffs load.
      </p>
    );
  }

  return (
    <>
      <p className={styles.disclaimer}>
        These are pattern matches on file paths, commit metadata and tags. They describe what the data looks like, not
        what anyone intended, and each entry states the rule that fired.{' '}
        {formatNumber(milestones.length)} milestone{milestones.length === 1 ? '' : 's'} across{' '}
        {formatNumber(groups.length)} commit{groups.length === 1 ? '' : 's'} — several rules often match the same
        commit.
      </p>

      <ul className={styles.milestoneList}>
        {groups.map(([index, items]) => {
          const commit = commits[index];
          return (
            <li key={index} className={styles.milestoneRow} data-active={index === currentIndex || undefined}>
              <div className={styles.milestoneHead}>
                <p className={styles.milestoneCommit}>
                  {commit ? commit.subject : 'Commit outside the loaded range'}
                </p>
                <p className={styles.milestoneMeta}>
                  <span className="tabular">Commit {index + 1}</span>
                  {commit ? <span className={styles.mono}>{commit.shortSha}</span> : null}
                  {commit ? <span>{formatDate(commit.author.date)}</span> : null}
                </p>
              </div>

              <ul className={styles.ruleList}>
                {items.map((milestone) => (
                  <li key={milestone.id} className={styles.rule}>
                    <p className={styles.ruleLabel}>
                      {milestone.label}
                      {milestone.confidence !== 'exact' ? (
                        <span className={styles.confidence} data-level={milestone.confidence}>
                          {milestone.confidence === 'window' ? 'approximate position' : 'confirmed by path history'}
                        </span>
                      ) : null}
                    </p>
                    <p className={styles.ruleEvidence}>{milestone.evidence}</p>
                    <p className={styles.ruleRule}>Rule: {milestone.rule}</p>
                    {milestone.confidence === 'window' && milestone.window ? (
                      <p className={styles.ruleWindow}>
                        Narrowed to commits {milestone.window.fromIndex + 1}–{milestone.window.toIndex + 1}; the exact
                        commit is not known because the diffs in between were not loaded.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>

              <button type="button" className={styles.milestoneAction} onClick={() => onInspect(index)}>
                Inspect commit
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
