'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Commit, Tag } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import { formatDate, formatNumber } from '@/lib/format';
import { describeLoadedRange } from '@/lib/range';
import { OLDER_STEP, MAX_COMMITS } from './States';
import { useVirtualRows } from './hooks';
import styles from './history-column.module.css';

/**
 * Fixed row height, matched exactly by the stylesheet.
 *
 * A two-line subject box (2 × 20px, clamped) plus an 18px meta line, centred in
 * 80px. Fixed rather than intrinsic: a row that grows with its
 * content makes every virtualisation offset a guess, and a subject clipped after
 * six words makes the list unreadable. Two lines carries almost every real
 * subject; the rest is in the heading, the tooltip and the accessible name.
 */
const ROW_HEIGHT = 80;

type Props = {
  commits: Commit[];
  currentIndex: number;
  milestones: Milestone[];
  tags: Tag[];
  totalCommits: number | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  canLoadOlder: boolean;
  /**
   * False when something else already provides the heading — the drawer names
   * itself, and "History / History" is a heading repeated, not a heading.
   */
  showHeading?: boolean;
  onSeek: (index: number) => void;
  onLoadOlder: () => void;
};

export function HistoryColumn({
  commits,
  currentIndex,
  milestones,
  tags,
  totalCommits,
  hasOlder,
  loadingOlder,
  canLoadOlder,
  showHeading = true,
  onSeek,
  onLoadOlder,
}: Props) {
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const milestoneIndices = useMemo(() => new Set(milestones.map((m) => m.commitIndex)), [milestones]);
  const tagsByIndex = useMemo(() => {
    const bySha = new Map(tags.map((tag) => [tag.sha, tag.name]));
    const byIndex = new Map<number, string>();
    for (const commit of commits) {
      const name = bySha.get(commit.sha);
      if (name) byIndex.set(commit.index, name);
    }
    return byIndex;
  }, [tags, commits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commits;
    /*
     * Subject, author and sha: the commit metadata already in the browser. This
     * deliberately does not search file contents — that would be a request per
     * commit, and claiming to search code while matching only messages would be
     * worse than not offering it.
     */
    return commits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(needle) ||
        commit.sha.startsWith(needle) ||
        commit.author.name.toLowerCase().includes(needle),
    );
  }, [commits, query]);

  const ordered = useMemo(
    () => (newestFirst ? [...filtered].reverse() : filtered),
    [filtered, newestFirst],
  );

  const virtual = useVirtualRows(listRef, ordered.length, ROW_HEIGHT);
  const visible = ordered.slice(virtual.start, virtual.end);

  /*
   * Follow the playhead, but only while the visitor is not reading the list:
   * scrolling somebody's view away mid-scan is worse than letting the current
   * row go off screen.
   */
  const interacting = useRef(false);
  useEffect(() => {
    if (interacting.current || query) return;
    const container = listRef.current;
    if (!container) return;
    const position = ordered.findIndex((commit) => commit.index === currentIndex);
    if (position < 0) return;
    const top = position * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 2 + ROW_HEIGHT / 2);
    }
  }, [currentIndex, ordered, query]);

  return (
    <div className={styles.column}>
      <div className={styles.head} data-headless={!showHeading || undefined}>
        {/* A sibling of the commit heading in the main column, so both are h2. */}
        {showHeading ? <h2 className={styles.title}>History</h2> : null}
        <p className={styles.range}>{describeLoadedRange(commits.length, totalCommits)}</p>
      </div>

      <div className={styles.tools}>
        <input
          className={styles.search}
          type="search"
          value={query}
          placeholder="Filter commits…"
          aria-label="Filter loaded commits by message, author or sha"
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* The order is named, so it can never be silently reversed. */}
        <button
          type="button"
          className={styles.order}
          onClick={() => setNewestFirst((value) => !value)}
          aria-label={`Sort order: ${newestFirst ? 'newest first' : 'oldest first'}. Switch to ${
            newestFirst ? 'oldest first' : 'newest first'
          }.`}
        >
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      {query ? (
        <p className={styles.filterCount}>
          {formatNumber(ordered.length)} of {formatNumber(commits.length)} loaded commits match
        </p>
      ) : null}

      <div
        className={styles.list}
        ref={listRef}
        onPointerDown={() => {
          interacting.current = true;
        }}
        onFocus={() => {
          interacting.current = true;
        }}
      >
        {ordered.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No commits match</p>
            <p className={styles.emptyText}>
              This filter looks at commit messages, authors and shas in the loaded range — not at file contents.
            </p>
            <button type="button" className={styles.emptyAction} onClick={() => setQuery('')}>
              Clear the filter
            </button>
          </div>
        ) : (
          <ul>
            <li aria-hidden="true" style={{ height: virtual.paddingTop }} />
            {visible.map((commit) => (
              <li key={commit.sha}>
                <button
                  type="button"
                  className={styles.item}
                  style={{ height: ROW_HEIGHT }}
                  data-active={commit.index === currentIndex || undefined}
                  aria-current={commit.index === currentIndex ? 'true' : undefined}
                  title={commit.subject}
                  aria-label={`Commit ${commit.index + 1}: ${commit.subject}`}
                  onClick={() => onSeek(commit.index)}
                >
                  <span className={styles.itemSubject}>{commit.subject}</span>
                  {/*
                   * A fixed four-column grid: number, date, sha, marker. Laid
                   * out rather than flowed, so the columns line up down the
                   * list however long a date or a tag name happens to be.
                   */}
                  <span className={styles.itemMeta}>
                    <span className={`${styles.itemIndex} tabular`}>{commit.index + 1}</span>
                    <span className={styles.itemDate}>{formatDate(commit.author.date)}</span>
                    <span className={`${styles.itemSha} tabular`}>{commit.shortSha}</span>
                    <span className={styles.itemMark}>
                      {tagsByIndex.has(commit.index) ? (
                        <span className={styles.itemTag} title={`Tagged ${tagsByIndex.get(commit.index)}`}>
                          {tagsByIndex.get(commit.index)}
                        </span>
                      ) : milestoneIndices.has(commit.index) ? (
                        <span className={styles.itemFlag} title="Matched a milestone rule" aria-hidden="true">
                          ◆
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            <li
              aria-hidden="true"
              style={{ height: Math.max(0, virtual.totalHeight - virtual.paddingTop - visible.length * ROW_HEIGHT) }}
            />
          </ul>
        )}
      </div>

      {hasOlder ? (
        <div className={styles.foot}>
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
          <p className={styles.footNote}>
            {canLoadOlder
              ? totalCommits !== null
                ? `${formatNumber(commits.length)} of ${formatNumber(totalCommits)} commits loaded.`
                : `${formatNumber(commits.length)} commits loaded; older history exists.`
              : `This session loads at most ${formatNumber(MAX_COMMITS)} commits. Older history exists but is not reachable here.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
