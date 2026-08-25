'use client';

import { useMemo, useRef, useState } from 'react';
import type { Commit, RepoMeta } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import type { ActivityMap, GrowthSeries } from '@/lib/stats/growth';
import { estimateLanguages } from '@/lib/stats/growth';
import type { Projection } from '@/lib/tree/projector';
import { BUILTIN_DEMO } from '@/lib/demos';
import { formatDate, formatNumber } from '@/lib/format';
import { ActivityGrid, GrowthChart, LanguageBar } from './Charts';
import { useVirtualRows } from './hooks';
import styles from './insights-panel.module.css';
import shell from './shell.module.css';

const TABS = [
  { id: 'growth', label: 'Growth' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'commits', label: 'Commits' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type Props = {
  meta: RepoMeta | null;
  commits: Commit[];
  currentIndex: number;
  projection: Projection;
  growth: GrowthSeries | null;
  activity: ActivityMap | null;
  milestones: Milestone[];
  totalCommits: number | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  canLoadOlder: boolean;
  className?: string;
  onSeek: (index: number) => void;
  onLoadOlder: () => void;
};

export function InsightsPanel(props: Props) {
  const [tab, setTab] = useState<TabId>('growth');
  const tabsRef = useRef<HTMLDivElement>(null);
  const milestoneCount = props.milestones.length;

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex((item) => item.id === tab);
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + delta + TABS.length) % TABS.length]!;
    setTab(next.id);
    const button = tabsRef.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`);
    button?.focus();
  };

  return (
    <section className={`${shell.panel} ${styles.panel} ${props.className ?? ''}`} aria-labelledby="insights-heading">
      <h2 className="visually-hidden" id="insights-heading">
        Repository insights
      </h2>

      <div className={styles.tabs} role="tablist" aria-label="Insights" ref={tabsRef} onKeyDown={onTabKeyDown}>
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'milestones' && milestoneCount > 0 ? (
              <span className={styles.tabCount}>{milestoneCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={shell.panelBody} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'growth' ? <GrowthTab {...props} /> : null}
        {tab === 'milestones' ? <MilestonesTab {...props} /> : null}
        {tab === 'commits' ? <CommitsTab {...props} /> : null}
      </div>
    </section>
  );
}

function GrowthTab({ meta, commits, currentIndex, projection, growth, activity, totalCommits, onSeek }: Props) {
  const languages = useMemo(() => estimateLanguages(projection.files), [projection.files]);

  return (
    <div className={styles.stack}>
      {meta ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            {meta.dataSource === 'builtin' ? BUILTIN_DEMO.title : meta.slug}
            {meta.dataSource === 'builtin' ? <span className={styles.estimate}>{BUILTIN_DEMO.badge}</span> : null}
          </h3>
          {meta.description ? <p className={styles.description}>{meta.description}</p> : null}
          {meta.dataSource === 'builtin' ? (
            <p className={styles.disclosureInline}>{BUILTIN_DEMO.disclosure}</p>
          ) : meta.htmlUrl ? (
            <p className={styles.description}>
              <a href={meta.htmlUrl} target="_blank" rel="noreferrer noopener">
                Open on GitHub
              </a>
            </p>
          ) : null}
          <dl className={styles.facts}>
            <div>
              <dt>branch</dt>
              <dd className={styles.mono}>{meta.defaultBranch}</dd>
            </div>
            <div>
              <dt>created</dt>
              <dd>{formatDate(meta.createdAt)}</dd>
            </div>
            <div>
              <dt>stars</dt>
              <dd className="tabular">{formatNumber(meta.stars)}</dd>
            </div>
            <div>
              <dt>commits</dt>
              <dd className="tabular">{totalCommits === null ? '—' : formatNumber(totalCommits)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>Growth over the loaded range</h3>
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

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          File-type mix at commit {formatNumber(Math.min(currentIndex + 1, commits.length))}
          <span className={styles.estimate}>estimate</span>
        </h3>
        <LanguageBar estimate={languages} />
      </section>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>Where work happened</h3>
        {activity ? <ActivityGrid map={activity} onSeek={onSeek} /> : <p className={styles.empty}>Waiting for diffs.</p>}
      </section>
    </div>
  );
}

function MilestonesTab({ milestones, commits, currentIndex, onSeek }: Props) {
  // Several rules often fire on the same commit (a scaffold commit adds the
  // manifest, the framework config and the first TypeScript file at once), so
  // the list is grouped by commit rather than repeating the same header.
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
      <div className={styles.stack}>
        <p className={styles.empty}>
          No milestones detected yet. Rules that need commit diffs fire as those diffs load.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <p className={styles.disclaimer}>
        These are pattern matches on file paths, commit metadata and tags. They describe what the data looks like, not
        what anyone intended. Each entry states the rule that fired.
      </p>

      <ul className={styles.milestoneList}>
        {groups.map(([index, items]) => {
          const commit = commits[index];
          return (
            <li key={index}>
              <button
                type="button"
                className={styles.milestoneItem}
                data-active={index === currentIndex || undefined}
                onClick={() => onSeek(index)}
              >
                <span className={styles.milestoneTop}>
                  <span className={styles.milestoneCommit}>
                    {commit ? (
                      <>
                        <span className={styles.mono}>{commit.shortSha}</span> {commit.subject}
                      </>
                    ) : (
                      'unknown commit'
                    )}
                  </span>
                  <span className={`${styles.milestoneIndex} tabular`}>#{index + 1}</span>
                </span>

                <span className={styles.milestoneRules}>
                  {items.map((milestone) => (
                    <span key={milestone.id} className={styles.milestoneRuleBlock}>
                      <span className={styles.milestoneLabel}>{milestone.label}</span>
                      <span className={styles.milestoneEvidence}>{milestone.evidence}</span>
                      <span className={styles.milestoneRule}>{milestone.rule}</span>
                      {milestone.confidence !== 'exact' ? (
                        <span className={styles.milestoneConfidence}>
                          {milestone.confidence === 'window'
                            ? 'Position narrowed to a range, not a single commit.'
                            : 'Position confirmed by querying the commit history of that path.'}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const COMMIT_ROW_HEIGHT = 46;

function CommitsTab({
  commits,
  currentIndex,
  milestones,
  totalCommits,
  hasOlder,
  loadingOlder,
  canLoadOlder,
  onSeek,
  onLoadOlder,
}: Props) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const milestoneIndices = useMemo(() => new Set(milestones.map((m) => m.commitIndex)), [milestones]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commits;
    return commits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(needle) ||
        commit.sha.startsWith(needle) ||
        commit.author.name.toLowerCase().includes(needle),
    );
  }, [commits, query]);

  const ordered = useMemo(() => [...filtered].reverse(), [filtered]);
  const virtual = useVirtualRows(listRef, ordered.length, COMMIT_ROW_HEIGHT);
  const visible = ordered.slice(virtual.start, virtual.end);

  return (
    <div className={styles.commitsTab}>
      <div className={styles.commitTools}>
        <input
          className={styles.search}
          type="search"
          value={query}
          placeholder="Search loaded commits…"
          aria-label="Search commit messages, authors and shas within the loaded range"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className={`${styles.commitCount} tabular`}>
          {formatNumber(ordered.length)}
          {query ? ` / ${formatNumber(commits.length)}` : ''}
        </span>
      </div>

      <div className={styles.commitList} ref={listRef}>
        {ordered.length === 0 ? (
          <p className={styles.empty}>No commit in the loaded range matches “{query}”.</p>
        ) : (
          <ul>
            <li aria-hidden="true" style={{ height: virtual.paddingTop }} />
            {visible.map((commit) => (
              <li key={commit.sha}>
                <button
                  type="button"
                  className={styles.commitItem}
                  data-active={commit.index === currentIndex || undefined}
                  style={{ height: COMMIT_ROW_HEIGHT }}
                  onClick={() => onSeek(commit.index)}
                >
                  <span className={styles.commitTop}>
                    <span className={styles.commitSubject}>{commit.subject}</span>
                    {milestoneIndices.has(commit.index) ? (
                      <span className={styles.commitFlag} title="Matched a milestone rule" aria-label="milestone" />
                    ) : null}
                  </span>
                  <span className={styles.commitMeta}>
                    <span className={styles.mono}>{commit.shortSha}</span>
                    <span>{commit.author.name}</span>
                    <span>{formatDate(commit.author.date)}</span>
                    <span className={`${styles.commitIndex} tabular`}>#{commit.index + 1}</span>
                  </span>
                </button>
              </li>
            ))}
            <li
              aria-hidden="true"
              style={{ height: Math.max(0, virtual.totalHeight - virtual.paddingTop - visible.length * COMMIT_ROW_HEIGHT) }}
            />
          </ul>
        )}
      </div>

      {hasOlder ? (
        <div className={styles.loadMore}>
          <button type="button" className={styles.loadMoreButton} onClick={onLoadOlder} disabled={loadingOlder || !canLoadOlder}>
            {loadingOlder ? 'Loading…' : canLoadOlder ? 'Load 100 older commits' : 'History limit reached'}
          </button>
          <p className={styles.loadMoreNote}>
            {totalCommits !== null
              ? `${formatNumber(commits.length)} of ${formatNumber(totalCommits)} commits loaded.`
              : `${formatNumber(commits.length)} commits loaded; older history exists.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
