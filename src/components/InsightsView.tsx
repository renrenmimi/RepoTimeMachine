'use client';

import { useMemo, useState } from 'react';
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
    meta,
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
        {meta ? <RepositoryFacts meta={meta} totalCommits={totalCommits} /> : null}

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

        <MilestoneSection
          milestones={milestones}
          commits={commits}
          currentIndex={currentIndex}
          onInspect={onInspect}
        />

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
 * What the source says about the repository itself.
 *
 * Distinct from everything below it: these come from the repository's own
 * metadata rather than from the loaded range, so they are stated first and kept
 * apart from the figures that only describe the window.
 */
function RepositoryFacts({ meta, totalCommits }: { meta: RepoMeta; totalCommits: number | null }) {
  const builtin = meta.dataSource === 'builtin';

  return (
    <section className={styles.about} aria-labelledby="insights-about">
      {/* Named for what the block is: the repository's own name is in the H1
          directly above, and repeating it would be a heading repeated. */}
      <h2 className={styles.aboutTitle} id="insights-about">
        About this repository
      </h2>

      {meta.description ? <p className={styles.aboutText}>{meta.description}</p> : null}

      {/* The default branch is not repeated here: the source line under the
          repository's name already states which branch is being read. */}
      <dl className={styles.aboutFacts}>
        <div>
          <dt>Commits on the default branch</dt>
          {/* Unknown when GitHub's pagination header did not say, never 0. */}
          <dd className="tabular">{totalCommits === null ? 'Unknown' : formatNumber(totalCommits)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(meta.createdAt)}</dd>
        </div>
        <div>
          <dt>Last push</dt>
          <dd>{formatDate(meta.pushedAt)}</dd>
        </div>
        {builtin ? null : (
          <>
            <div>
              <dt>Stars</dt>
              <dd className="tabular">{formatNumber(meta.stars)}</dd>
            </div>
            <div>
              <dt>Forks</dt>
              <dd className="tabular">{formatNumber(meta.forks)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Licence</dt>
          <dd>{meta.license ?? 'None declared'}</dd>
        </div>
        <div>
          <dt>Primary language</dt>
          {/* GitHub's own guess, and labelled as GitHub's rather than ours. */}
          <dd>{meta.primaryLanguage ? `${meta.primaryLanguage} (per GitHub)` : 'Not reported'}</dd>
        </div>
      </dl>

      {meta.isArchived || meta.isFork ? (
        <p className={styles.aboutFlags}>
          {[meta.isArchived ? 'Archived' : null, meta.isFork ? 'A fork' : null].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {/*
       * No link is rendered when there is no repository to open — and rather
       * than repeat the synthetic-history sentence the source line already
       * carries, this says the thing that is missing and why.
       */}
      {meta.htmlUrl ? (
        <p className={styles.aboutText}>
          <a href={meta.htmlUrl} target="_blank" rel="noreferrer noopener">
            Open {meta.slug} on GitHub
          </a>
        </p>
      ) : (
        <p className={styles.aboutText}>
          There is nothing to open on GitHub: this history ships with the application.
        </p>
      )}
    </section>
  );
}

/**
 * The detected milestones, grouped by commit.
 *
 * Grouping matters for honesty as much as for layout: several rules commonly
 * fire on one commit, so a flat list of fifteen entries would read as fifteen
 * moments in the project's life when it might be four.
 */
/** Commits shown before the list has to be asked to open. */
const MILESTONE_PREVIEW = 5;

function MilestoneSection({
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
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => {
    const byIndex = new Map<number, Milestone[]>();
    for (const milestone of milestones) {
      const list = byIndex.get(milestone.commitIndex) ?? [];
      list.push(milestone);
      byIndex.set(milestone.commitIndex, list);
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  }, [milestones]);

  /*
   * The earliest ones, because this page reads chronologically and the first
   * few are where a repository's shape is decided. Expanding appends to the
   * list rather than replacing it, so nothing already read moves.
   */
  const shown = showAll ? groups : groups.slice(0, MILESTONE_PREVIEW);

  return (
    <section className={styles.block} aria-labelledby="insights-milestones">
      {/*
       * The control lives in the heading, not after the list.
       *
       * Below the list it moved down the page as the list grew, and the browser
       * scrolled to follow the button it had just focused — which threw the
       * reader to the bottom of a section they were part-way through.
       */}
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle} id="insights-milestones">
          Milestones
          <span className={styles.blockCount}>{formatNumber(milestones.length)}</span>
        </h2>

        {groups.length > MILESTONE_PREVIEW ? (
          <button
            type="button"
            className={styles.milestoneMore}
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? `Show the first ${MILESTONE_PREVIEW} only` : 'Show all milestones'}
            {showAll ? null : (
              <span className={styles.milestoneMoreCount}>
                {formatNumber(groups.length - MILESTONE_PREVIEW)} more commit
                {groups.length - MILESTONE_PREVIEW === 1 ? '' : 's'}
              </span>
            )}
          </button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className={styles.empty}>
          No milestones detected yet. Rules that need commit diffs fire as those diffs load.
        </p>
      ) : (
        <>
      <p className={styles.disclaimer}>
        These are pattern matches on file paths, commit metadata and tags. They describe what the data looks like, not
        what anyone intended, and each entry states the rule that fired.{' '}
        {formatNumber(milestones.length)} milestone{milestones.length === 1 ? '' : 's'} across{' '}
        {formatNumber(groups.length)} commit{groups.length === 1 ? '' : 's'} — several rules often match the same
        commit.
      </p>

      <ul className={styles.milestoneList}>
        {shown.map(([index, items]) => {
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
      )}
    </section>
  );
}
