import type { FileChange, RepoTree } from '@/lib/domain/types';
import { classifyPath, type FileFacts } from './classify';

export type FileState = {
  size: number | null;
  /** Blob sha when known. Null for files we only learned about from a commit diff. */
  sha: string | null;
};

export type FileSet = ReadonlyMap<string, FileState>;

export type PathStatus = 'added' | 'modified' | 'removed' | 'renamed';

export type PathChange = {
  status: PathStatus;
  previousPath: string | null;
  additions: number;
  deletions: number;
};

export type ChangeMap = ReadonlyMap<string, PathChange>;

/** Hard ceiling so a pathological repository cannot exhaust browser memory. */
export const MAX_TRACKED_FILES = 40_000;

export function fileSetFromTree(tree: RepoTree): Map<string, FileState> {
  const set = new Map<string, FileState>();
  for (const entry of tree.entries) {
    if (entry.type !== 'blob') continue;
    if (set.size >= MAX_TRACKED_FILES) break;
    set.set(entry.path, { size: entry.size, sha: entry.sha });
  }
  return set;
}

/**
 * Applies one commit's file changes to a file set.
 *
 * Renames are represented as a removal of the previous path plus an addition of
 * the new one, which is what a viewer needs to see in the tree, while the change
 * map keeps `previousPath` so the UI can say "renamed from …".
 */
export function applyFileChanges(
  base: FileSet,
  changes: readonly FileChange[],
): { next: Map<string, FileState>; changed: Map<string, PathChange>; removed: string[] } {
  const next = new Map(base);
  const changed = new Map<string, PathChange>();
  const removed: string[] = [];

  for (const change of changes) {
    const additions = change.additions;
    const deletions = change.deletions;

    switch (change.status) {
      case 'removed': {
        next.delete(change.path);
        removed.push(change.path);
        changed.set(change.path, { status: 'removed', previousPath: null, additions, deletions });
        break;
      }
      case 'renamed': {
        if (change.previousPath) {
          next.delete(change.previousPath);
          removed.push(change.previousPath);
        }
        if (next.size < MAX_TRACKED_FILES) {
          next.set(change.path, { size: null, sha: null });
        }
        changed.set(change.path, {
          status: 'renamed',
          previousPath: change.previousPath,
          additions,
          deletions,
        });
        break;
      }
      case 'added':
      case 'copied': {
        if (next.size < MAX_TRACKED_FILES || next.has(change.path)) {
          next.set(change.path, { size: null, sha: null });
        }
        changed.set(change.path, { status: 'added', previousPath: null, additions, deletions });
        break;
      }
      default: {
        // modified / changed / unchanged
        if (!next.has(change.path) && next.size < MAX_TRACKED_FILES) {
          // GitHub occasionally reports a modification for a path our snapshot
          // never saw (e.g. the baseline tree was truncated). Treat it as present.
          next.set(change.path, { size: null, sha: null });
        }
        changed.set(change.path, { status: 'modified', previousPath: null, additions, deletions });
        break;
      }
    }
  }

  return { next, changed, removed };
}

/** Reverses a commit's changes, so playback can step backwards without refetching. */
export function revertFileChanges(
  after: FileSet,
  changes: readonly FileChange[],
  /** File states as they were before the commit, when known. */
  before?: FileSet,
): Map<string, FileState> {
  const next = new Map(after);
  for (const change of changes) {
    switch (change.status) {
      case 'added':
      case 'copied':
        next.delete(change.path);
        break;
      case 'removed':
        next.set(change.path, before?.get(change.path) ?? { size: null, sha: null });
        break;
      case 'renamed':
        next.delete(change.path);
        if (change.previousPath) {
          next.set(change.previousPath, before?.get(change.previousPath) ?? { size: null, sha: null });
        }
        break;
      default:
        break;
    }
  }
  return next;
}

export type TreeNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  depth: number;
  /** Files directly and indirectly contained, for directories. */
  fileCount: number;
  size: number | null;
  status: PathStatus | null;
  /** True when this directory contains a changed descendant. */
  containsChange: boolean;
  facts: FileFacts | null;
};

type MutableNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: Map<string, MutableNode>;
  size: number | null;
  fileCount: number;
  status: PathStatus | null;
  containsChange: boolean;
};

function emptyDir(name: string, path: string): MutableNode {
  return { name, path, type: 'dir', children: new Map(), size: null, fileCount: 0, status: null, containsChange: false };
}

/**
 * Builds the nested directory model for a file set.
 *
 * `ghosts` are paths removed by the current commit: they are shown one last time
 * so a deletion is visible, then vanish when the timeline moves on.
 */
export function buildTree(
  files: FileSet,
  changes: ChangeMap = new Map(),
  ghosts: readonly string[] = [],
): MutableNode {
  const root = emptyDir('', '');

  const insert = (path: string, state: FileState | null, ghost: boolean) => {
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return;
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      const childPath = node.path ? `${node.path}/${segment}` : segment;
      let child = node.children.get(segment);
      if (!child) {
        child = emptyDir(segment, childPath);
        node.children.set(segment, child);
      }
      node = child;
    }
    const leafName = segments[segments.length - 1]!;
    const change = changes.get(path) ?? null;
    node.children.set(leafName, {
      name: leafName,
      path,
      type: 'file',
      children: new Map(),
      size: state?.size ?? null,
      fileCount: ghost ? 0 : 1,
      status: ghost ? 'removed' : (change?.status ?? null),
      containsChange: Boolean(change) || ghost,
    });
  };

  for (const [path, state] of files) insert(path, state, false);
  for (const path of ghosts) {
    if (!files.has(path)) insert(path, null, true);
  }

  const rollUp = (node: MutableNode): void => {
    if (node.type === 'file') return;
    let count = 0;
    let containsChange = false;
    for (const child of node.children.values()) {
      rollUp(child);
      count += child.type === 'file' ? child.fileCount : child.fileCount;
      containsChange = containsChange || child.containsChange;
    }
    node.fileCount = count;
    node.containsChange = containsChange;
  };
  rollUp(root);

  return root;
}

function sortChildren(node: MutableNode): MutableNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en');
  });
}

export type FlattenOptions = {
  expanded: ReadonlySet<string>;
  /** Stop after this many rows; the caller shows a "…more" affordance. */
  maxRows?: number;
  /** When set, only paths containing this substring (case-insensitive) are kept. */
  filter?: string;
};

export type FlattenResult = {
  rows: TreeNode[];
  /** True when `maxRows` cut the list short. */
  truncated: boolean;
  totalFiles: number;
};

/** Produces the ordered, visible rows for the current expansion state. */
export function flattenTree(root: MutableNode, options: FlattenOptions): FlattenResult {
  const { expanded, maxRows = 4000 } = options;
  const filter = options.filter?.trim().toLowerCase();
  const rows: TreeNode[] = [];
  let truncated = false;

  const matches = (node: MutableNode): boolean => {
    if (!filter) return true;
    if (node.path.toLowerCase().includes(filter)) return true;
    if (node.type === 'dir') {
      for (const child of node.children.values()) {
        if (matches(child)) return true;
      }
    }
    return false;
  };

  const walk = (node: MutableNode, depth: number): void => {
    if (truncated) return;
    for (const child of sortChildren(node)) {
      if (filter && !matches(child)) continue;
      if (rows.length >= maxRows) {
        truncated = true;
        return;
      }
      rows.push({
        path: child.path,
        name: child.name,
        type: child.type,
        depth,
        fileCount: child.fileCount,
        size: child.size,
        status: child.status,
        containsChange: child.containsChange,
        facts: child.type === 'file' ? classifyPath(child.path) : null,
      });
      // A filter implicitly expands everything it matched, otherwise results hide.
      if (child.type === 'dir' && (filter ? true : expanded.has(child.path))) {
        walk(child, depth + 1);
      }
    }
  };

  walk(root, 0);
  return { rows, truncated, totalFiles: root.fileCount };
}

/**
 * Chooses the initial expansion: top-level directories only.
 *
 * That shows the shape of the project without guessing, and — unlike a
 * size-based rule — it does not open and close folders on its own as the
 * timeline moves. Anything deeper is opened by the visitor, or revealed
 * automatically because the current commit changed something inside it.
 */
export function defaultExpansion(root: MutableNode, budget = 400): Set<string> {
  const expanded = new Set<string>();
  let rows = root.children.size;

  for (const child of sortChildren(root)) {
    if (child.type !== 'dir') continue;
    const cost = child.children.size;
    if (rows + cost > budget) break;
    expanded.add(child.path);
    rows += cost;
  }

  return expanded;
}

/** Every ancestor directory of a path, so the UI can reveal a changed file. */
export function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = current ? `${current}/${segments[i]}` : segments[i]!;
    out.push(current);
  }
  return out;
}

export type { MutableNode as TreeRoot };
