'use client';

import { useMemo, useRef, useState } from 'react';
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
import shell from './shell.module.css';

const ROW_HEIGHT = 24;

type Props = {
  projection: Projection;
  commits: Commit[];
  currentIndex: number;
  details: ReadonlyMap<string, CommitDetail>;
  loading: boolean;
  /** Bumped whenever the controller loads new data; used as a memo dependency. */
  version: number;
  className?: string;
  onSeek: (index: number) => void;
};

export function TreePanel({ projection, commits, currentIndex, details, loading, version, className, onSeek }: Props) {
  /**
   * Expansion is derived, not stored.
   *
   * The default is "open what is small enough to read"; on top of that, every
   * folder containing a change in this commit is opened so the change is
   * visible. `overrides` holds only the folders the visitor toggled themselves,
   * which is what should survive moving along the timeline.
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
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
    const isOpen = expanded.has(path);
    setOverrides((current) => {
      const next = new Map(current);
      next.set(path, !isOpen);
      return next;
    });
  };

  return (
    <section className={`${shell.panel} ${styles.panel} ${className ?? ''}`} aria-labelledby="tree-heading">
      <header className={shell.panelHead}>
        <h2 className={shell.panelTitle} id="tree-heading">
          Working tree
        </h2>
        <span className={shell.panelHeadSpacer} />
        <FidelityBadge projection={projection} commits={commits} onSeek={onSeek} />
      </header>

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
      </div>

      <div className={shell.panelBody} ref={bodyRef}>
        {loading && rows.length === 0 ? (
          <TreeSkeleton />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>
            {filter ? `No paths match “${filter}”.` : 'No files at this point in the history.'}
          </p>
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
        <FileInspector info={selectedInfo} onSeek={onSeek} onClose={() => setSelectedPath(null)} />
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
};

function TreeRowItem({ node, expanded, selected, commitSha, onToggle, onSelect }: RowProps) {
  const isDir = node.type === 'dir';
  const badge = node.facts ? kindLabel(node.facts.kind) : null;

  return (
    <li
      className={styles.row}
      data-status={node.status ?? undefined}
      data-selected={selected || undefined}
      data-dir={isDir || undefined}
      style={{ height: ROW_HEIGHT, paddingLeft: `${node.depth * 12 + 8}px` }}
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
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
              <path d="M2 0.5 6.5 4 2 7.5z" />
            </svg>
          ) : null}
        </span>

        {/* Remounting on every commit replays the pulse without a timer. */}
        <span
          key={`${node.path}:${commitSha}`}
          className={styles.marker}
          data-status={node.status ?? undefined}
          aria-hidden="true"
        />

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
    </li>
  );
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

function FidelityBadge({
  projection,
  commits,
  onSeek,
}: {
  projection: Projection;
  commits: Commit[];
  onSeek: (index: number) => void;
}) {
  const sourceCommit = projection.sourceIndex >= 0 ? commits[projection.sourceIndex] : undefined;

  if (projection.sourceIndex < 0) {
    return (
      <span className={styles.fidelity} data-level="unknown" title="No file tree has been read yet.">
        no snapshot
      </span>
    );
  }

  if (projection.fidelity === 'exact') {
    return (
      <span className={styles.fidelity} data-level="exact" title="A file tree was read at this exact commit.">
        exact
      </span>
    );
  }

  if (projection.fidelity === 'derived') {
    return (
      <span
        className={styles.fidelity}
        data-level="derived"
        title={`Rebuilt from the tree at commit ${projection.sourceIndex + 1} plus every diff since. No gaps.`}
      >
        rebuilt
      </span>
    );
  }

  return (
    <button
      type="button"
      className={styles.fidelity}
      data-level="partial"
      onClick={() => sourceCommit && onSeek(projection.sourceIndex)}
      title={`Built from the tree at commit ${projection.sourceIndex + 1}; ${projection.missingCommits} commit diff${projection.missingCommits === 1 ? '' : 's'} in between are still loading. Click to jump to that snapshot.`}
    >
      ≈ {projection.missingCommits} gap{projection.missingCommits === 1 ? '' : 's'}
    </button>
  );
}

type FileInfo = {
  path: string;
  present: boolean;
  size: number | null;
  kind: string;
  language: string | null;
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
    lastChange,
    searchedCommits: searched,
  };
}

function FileInspector({ info, onSeek, onClose }: { info: FileInfo; onSeek: (index: number) => void; onClose: () => void }) {
  const { dir, name } = splitPath(info.path);
  return (
    <aside className={styles.inspector} aria-label="Selected file">
      <div className={styles.inspectorHead}>
        <p className={styles.inspectorPath} title={info.path}>
          <span className={styles.inspectorDir}>{dir}</span>
          <span className={styles.inspectorName}>{name}</span>
        </p>
        <button type="button" className={styles.inspectorClose} onClick={onClose} aria-label="Clear file selection">
          ✕
        </button>
      </div>

      <dl className={styles.inspectorFacts}>
        <div>
          <dt>type</dt>
          <dd>{info.language ?? info.kind}</dd>
        </div>
        <div>
          <dt>size</dt>
          <dd>{info.size !== null ? formatBytes(info.size) : 'unknown here'}</dd>
        </div>
      </dl>

      {info.lastChange ? (
        <button type="button" className={styles.inspectorChange} onClick={() => onSeek(info.lastChange!.commit.index)}>
          <span className={styles.inspectorChangeLabel}>last change at or before this point</span>
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
        <li key={index} style={{ width: `${width}%`, marginLeft: `${(index % 3) * 12 + 8}px` }} />
      ))}
    </ul>
  );
}
