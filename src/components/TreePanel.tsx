'use client';

import { useMemo, useRef } from 'react';
import type { Commit, CommitDetail } from '@/lib/domain/types';
import { formatBytes, formatNumber, splitPath } from '@/lib/format';
import { classifyPath, kindLabel } from '@/lib/tree/classify';
import {
  ancestorsOf,
  buildTree,
  defaultExpansion,
  flattenTree,
  type TreeNode,
} from '@/lib/tree/build';
import type { Projection } from '@/lib/tree/projector';
import { useVirtualRows } from './hooks';
import styles from './tree-panel.module.css';

/** Must match the row height in the stylesheet, or virtualisation drifts. */
const ROW_HEIGHT = 34;

/**
 * What the visitor has done to the tree, held outside this component.
 *
 * The panel unmounts when the view changes, so keeping any of this locally
 * meant coming back from Compare or Insights found a collapsed, unfiltered tree
 * with nothing selected — losing work the visitor had done to get there.
 */
export type TreeViewState = {
  filter: string;
  /** Only the folders the visitor toggled themselves. */
  overrides: ReadonlyMap<string, boolean>;
  selectedPath: string | null;
};

export const EMPTY_TREE_VIEW: TreeViewState = {
  filter: '',
  overrides: new Map(),
  selectedPath: null,
};

type Props = {
  projection: Projection;
  commits: Commit[];
  currentIndex: number;
  details: ReadonlyMap<string, CommitDetail>;
  loading: boolean;
  /** Bumped whenever the controller loads new data; used as a memo dependency. */
  version: number;
  className?: string;
  view: TreeViewState;
  onView: (next: TreeViewState) => void;
  onSeek: (index: number) => void;
  /** Opens this file's diff in the Changes view, on the same commit. */
  onOpenDiff: (path: string) => void;
};

export function TreePanel({
  projection,
  commits,
  currentIndex,
  details,
  loading,
  version,
  className,
  view,
  onView,
  onSeek,
  onOpenDiff,
}: Props) {
  /**
   * Expansion is derived, not stored.
   *
   * The default is "open what is small enough to read"; on top of that, every
   * folder containing a change in this commit is opened so the change is
   * visible. `overrides` holds only the folders the visitor toggled themselves,
   * which is what should survive moving along the history — and moving away
   * from the replay and back.
   */
  const { filter, overrides, selectedPath } = view;
  const setFilter = (next: string) => onView({ ...view, filter: next });
  const setSelectedPath = (next: string | null) => onView({ ...view, selectedPath: next });
  const bodyRef = useRef<HTMLDivElement>(null);

  const root = useMemo(
    () => buildTree(projection.files, projection.changes, projection.ghosts),
    [projection],
  );

  const automatic = useMemo(() => {
    const open = defaultExpansion(root);
    for (const path of projection.changes.keys()) {
      for (const ancestor of ancestorsOf(path)) open.add(ancestor);
    }
    return open;
  }, [root, projection.changes]);

  const expanded = useMemo(() => {
    const open = new Set(automatic);
    for (const [path, isOpen] of overrides) {
      if (isOpen) open.add(path);
      else open.delete(path);
    }
    return open;
  }, [automatic, overrides]);

  const { rows, truncated, totalFiles } = useMemo(
    () => flattenTree(root, { expanded, filter, maxRows: 6000 }),
    [root, expanded, filter],
  );

  const virtual = useVirtualRows(bodyRef, rows.length, ROW_HEIGHT);
  const visible = rows.slice(virtual.start, virtual.end);
  const currentSha = commits[currentIndex]?.sha ?? '';

  const selectedInfo = useMemo(
    () => (selectedPath ? describeFile(selectedPath, projection, commits, currentIndex, details) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPath, projection, commits, currentIndex, details, version],
  );

  const toggle = (path: string) => {
    const next = new Map(overrides);
    next.set(path, !expanded.has(path));
    onView({ ...view, overrides: next });
  };

  return (
    <section className={`${styles.panel} ${className ?? ''}`} aria-label="Repository files at this commit">
      {/*
       * One row: what you can do to this list, and how the list was produced.
       * These were two stacked bands, which on a short window cost 100px of the
       * reading area to say two things that fit comfortably side by side.
       */}
      <div className={styles.tools}>
        <input
          id="tree-filter"
          className={styles.filter}
          type="search"
          value={filter}
          placeholder="Filter paths…"
          aria-label="Filter file paths in the tree"
          onChange={(event) => setFilter(event.target.value)}
        />
        <span className={`${styles.count} tabular`}>
          {formatNumber(totalFiles)} file{totalFiles === 1 ? '' : 's'}
        </span>
        <FidelityLine projection={projection} commits={commits} onSeek={onSeek} />
      </div>

      <div className={styles.body} ref={bodyRef}>
        {loading && rows.length === 0 ? (
          <TreeSkeleton />
        ) : rows.length === 0 ? (
          /* Three different nothings, told apart. */
          filter ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No path matches “{filter}”</p>
              <p className={styles.emptyText}>
                The filter matches paths in this commit&rsquo;s tree, not file contents.
              </p>
              <button type="button" className={styles.emptyAction} onClick={() => setFilter('')}>
                Clear the filter
              </button>
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No files at this point in the history</p>
              <p className={styles.emptyText}>
                Nothing had been committed to the tree yet at this commit.
              </p>
            </div>
          )
        ) : (
          <ul className={styles.list} role="tree" aria-label="Repository files">
            <li aria-hidden="true" style={{ height: virtual.paddingTop }} />
            {visible.map((node) => (
              <TreeRowItem
                key={node.path}
                node={node}
                expanded={expanded.has(node.path)}
                selected={selectedPath === node.path}
                commitSha={currentSha}
                onToggle={toggle}
                onSelect={setSelectedPath}
                onOpenDiff={onOpenDiff}
              />
            ))}
            <li
              aria-hidden="true"
              style={{ height: Math.max(0, virtual.totalHeight - virtual.paddingTop - visible.length * ROW_HEIGHT) }}
            />
          </ul>
        )}

        {truncated ? (
          <p className={styles.note}>
            This view stops at 6,000 rows. Collapse folders or filter to see the rest.
          </p>
        ) : null}
      </div>

      {selectedInfo ? (
        <FileInspector
          info={selectedInfo}
          onSeek={onSeek}
          onOpenDiff={onOpenDiff}
          onClose={() => setSelectedPath(null)}
        />
      ) : null}
    </section>
  );
}

type RowProps = {
  node: TreeNode;
  expanded: boolean;
  selected: boolean;
  commitSha: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onOpenDiff: (path: string) => void;
};

function TreeRowItem({ node, expanded, selected, commitSha, onToggle, onSelect, onOpenDiff }: RowProps) {
  const isDir = node.type === 'dir';
  const badge = node.facts ? kindLabel(node.facts.kind) : null;
  // A deleted file is no longer in the tree, so its diff lives in Changes only.
  const hasDiff = !isDir && node.status !== null && node.status !== undefined;

  return (
    <li
      className={styles.row}
      data-status={node.status ?? undefined}
      data-selected={selected || undefined}
      data-dir={isDir || undefined}
      style={{ height: ROW_HEIGHT, paddingLeft: `${node.depth * 18 + 12}px` }}
      role="treeitem"
      aria-expanded={isDir ? expanded : undefined}
      aria-selected={selected || undefined}
    >
      <button
        type="button"
        className={styles.rowButton}
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
        title={node.path}
      >
        <span className={styles.chevron} aria-hidden="true">
          {isDir ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 8 8"
              fill="currentColor"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
            >
              <path d="M2 0.5 6.5 4 2 7.5z" />
            </svg>
          ) : null}
        </span>

        {/* Remounting on every commit replays the highlight without a timer. */}
        <span
          key={`${node.path}:${commitSha}`}
          className={styles.marker}
          data-status={node.status ?? undefined}
          aria-hidden="true"
        >
          {node.status ? statusSymbol(node.status) : null}
        </span>

        <span className={styles.name}>{node.name}</span>

        {badge ? <span className={styles.badge}>{badge}</span> : null}

        <span className={styles.meta}>
          {isDir
            ? node.fileCount > 0
              ? formatNumber(node.fileCount)
              : ''
            : node.size !== null
              ? formatBytes(node.size)
              : ''}
        </span>

        {node.status ? <span className="visually-hidden">{statusWord(node.status)} in this commit</span> : null}
      </button>

      {hasDiff ? (
        <button
          type="button"
          className={styles.rowDiff}
          onClick={() => onOpenDiff(node.path)}
          aria-label={`Open the diff for ${node.path}`}
          title="Open this file's diff for this commit"
        >
          Diff
        </button>
      ) : null}
    </li>
  );
}

function statusSymbol(status: NonNullable<TreeNode['status']>): string {
  switch (status) {
    case 'added':
      return '+';
    case 'removed':
      return '−';
    case 'renamed':
      return '→';
    default:
      return '~';
  }
}

function statusWord(status: NonNullable<TreeNode['status']>): string {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * How this file list was produced.
 *
 * Three genuinely different states — read here, rebuilt from a nearby tree plus
 * every diff since, or rebuilt with diffs still missing — and only the third is
 * a caveat, so only the third is styled as one.
 */
function FidelityLine({
  projection,
  commits,
  onSeek,
}: {
  projection: Projection;
  commits: Commit[];
  onSeek: (index: number) => void;
}) {
  if (projection.sourceIndex < 0) {
    return (
      <p className={styles.fidelity} data-level="unknown">
        <span className={styles.fidelityBadge}>No snapshot</span>
        <span className={styles.fidelityText}>No file tree has been read yet, so there is nothing to show.</span>
      </p>
    );
  }

  if (projection.fidelity === 'exact') {
    return (
      <p className={styles.fidelity} data-level="exact">
        <span className={styles.fidelityBadge}>Snapshot</span>
        <span className={styles.fidelityText}>A file tree was read at this exact commit.</span>
        {projection.sourceTruncated ? (
          <span className={styles.fidelityWarn}>
            GitHub truncated it because the repository is very large, so some paths are missing.
          </span>
        ) : null}
      </p>
    );
  }

  if (projection.fidelity === 'derived') {
    return (
      <p className={styles.fidelity} data-level="derived">
        <span className={styles.fidelityBadge}>Reconstructed</span>
        <span className={styles.fidelityText}>
          Rebuilt from the tree at commit {projection.sourceIndex + 1} plus every diff since. No gaps.
        </span>
      </p>
    );
  }

  return (
    <p className={styles.fidelity} data-level="partial">
      <span className={styles.fidelityBadge}>Approximate</span>
      <span className={styles.fidelityText}>
        Built from the tree at commit {projection.sourceIndex + 1}; {formatNumber(projection.missingCommits)} commit
        diff{projection.missingCommits === 1 ? '' : 's'} in between have not loaded, so paths they touched may be
        wrong.
      </span>
      <button
        type="button"
        className={styles.fidelityAction}
        onClick={() => commits[projection.sourceIndex] && onSeek(projection.sourceIndex)}
      >
        Go to commit {projection.sourceIndex + 1}
      </button>
    </p>
  );
}

type FileInfo = {
  path: string;
  present: boolean;
  size: number | null;
  kind: string;
  language: string | null;
  changedHere: boolean;
  lastChange: { commit: Commit; additions: number; deletions: number; status: string } | null;
  searchedCommits: number;
};

function describeFile(
  path: string,
  projection: Projection,
  commits: Commit[],
  currentIndex: number,
  details: ReadonlyMap<string, CommitDetail>,
): FileInfo {
  const state = projection.files.get(path);
  let lastChange: FileInfo['lastChange'] = null;
  let searched = 0;

  // Walk backwards through the commits whose diff we hold, newest first.
  for (let i = Math.min(currentIndex, commits.length - 1); i >= 0; i -= 1) {
    const commit = commits[i]!;
    const detail = details.get(commit.sha);
    if (!detail) continue;
    searched += 1;
    const file = detail.files.find((entry) => entry.path === path || entry.previousPath === path);
    if (file) {
      lastChange = {
        commit,
        additions: file.additions,
        deletions: file.deletions,
        status: file.status,
      };
      break;
    }
  }

  const facts = classifyPath(path);
  return {
    path,
    present: Boolean(state),
    size: state?.size ?? null,
    kind: facts.kind,
    language: facts.language,
    changedHere: projection.changes.has(path),
    lastChange,
    searchedCommits: searched,
  };
}

function FileInspector({
  info,
  onSeek,
  onOpenDiff,
  onClose,
}: {
  info: FileInfo;
  onSeek: (index: number) => void;
  onOpenDiff: (path: string) => void;
  onClose: () => void;
}) {
  const { dir, name } = splitPath(info.path);
  return (
    <aside className={styles.inspector} aria-label="Selected file">
      <div className={styles.inspectorHead}>
        <p className={styles.inspectorPath} title={info.path}>
          <span className={styles.inspectorDir}>{dir}</span>
          <span className={styles.inspectorName}>{name}</span>
        </p>
        <button type="button" className={styles.inspectorClose} onClick={onClose}>
          Clear
        </button>
      </div>

      <dl className={styles.inspectorFacts}>
        <div>
          <dt>Type</dt>
          <dd>{info.language ?? info.kind}</dd>
        </div>
        <div>
          <dt>Size</dt>
          {/* Unknown rather than 0: a tree that omitted the size did not report zero. */}
          <dd>{info.size !== null ? formatBytes(info.size) : 'Unknown here'}</dd>
        </div>
      </dl>

      {info.changedHere ? (
        <button type="button" className={styles.inspectorAction} onClick={() => onOpenDiff(info.path)}>
          Open this file&rsquo;s diff
        </button>
      ) : info.lastChange ? (
        <button
          type="button"
          className={styles.inspectorChange}
          onClick={() => onSeek(info.lastChange!.commit.index)}
        >
          <span className={styles.inspectorChangeLabel}>Last change at or before this point</span>
          <span className={styles.inspectorChangeSubject}>{info.lastChange.commit.subject}</span>
          <span className={styles.inspectorChangeMeta}>
            <span className={styles.mono}>{info.lastChange.commit.shortSha}</span>
            <span className={styles.plus}>+{info.lastChange.additions}</span>
            <span className={styles.minus}>−{info.lastChange.deletions}</span>
          </span>
        </button>
      ) : (
        <p className={styles.inspectorNote}>
          No change found in the {info.searchedCommits} commit diff{info.searchedCommits === 1 ? '' : 's'} loaded up to
          this point.
        </p>
      )}
    </aside>
  );
}

function TreeSkeleton() {
  return (
    <ul className={styles.skeleton} aria-hidden="true">
      {[68, 44, 82, 56, 74, 38, 90, 50, 64, 78, 46, 70].map((width, index) => (
        <li key={index} style={{ width: `${width}%`, marginLeft: `${(index % 3) * 18 + 12}px` }} />
      ))}
    </ul>
  );
}
