import type { Commit, CommitDetail, FileChange, RepoTree } from '@/lib/domain/types';
import { Lru } from '@/lib/cache/lru';
import { applyFileChanges, fileSetFromTree, type ChangeMap, type FileSet, type PathChange } from './build';

/** Labels for what one commit did, without touching the projected file set. */
function describeChanges(detail: { files: readonly FileChange[] }): {
  changes: ChangeMap;
  ghosts: string[];
} {
  const changes = new Map<string, PathChange>();
  const ghosts: string[] = [];
  for (const file of detail.files) {
    const shared = { additions: file.additions, deletions: file.deletions };
    switch (file.status) {
      case 'removed':
        changes.set(file.path, { status: 'removed', previousPath: null, ...shared });
        ghosts.push(file.path);
        break;
      case 'renamed':
        changes.set(file.path, { status: 'renamed', previousPath: file.previousPath, ...shared });
        if (file.previousPath) ghosts.push(file.previousPath);
        break;
      case 'added':
      case 'copied':
        changes.set(file.path, { status: 'added', previousPath: null, ...shared });
        break;
      default:
        changes.set(file.path, { status: 'modified', previousPath: null, ...shared });
        break;
    }
  }
  return { changes, ghosts };
}

export type Projection = {
  commitIndex: number;
  files: FileSet;
  /** Changes introduced by the commit at `commitIndex`, when its diff is known. */
  changes: ChangeMap;
  /** Paths this commit deleted, kept for one frame so the removal is visible. */
  ghosts: string[];
  /**
   * How this file list was produced:
   *  - `exact`   : a tree read directly at this commit;
   *  - `derived` : a nearby tree plus every intervening diff;
   *  - `partial` : a nearby tree, but some intervening diffs are not loaded.
   */
  fidelity: 'exact' | 'derived' | 'partial';
  /** Commits between the source snapshot and here whose diffs we do not have. */
  missingCommits: number;
  /** Index of the snapshot this projection was built from. */
  sourceIndex: number;
  /** True when GitHub truncated the source tree. */
  sourceTruncated: boolean;
};

type CacheEntry = {
  files: FileSet;
  missingCommits: number;
  sourceIndex: number;
  sourceTruncated: boolean;
};

/**
 * Reconstructs "what the repository looked like at commit N".
 *
 * Two data sources feed it: full trees read at a handful of checkpoint commits
 * (one request each, exact) and per-commit diffs (one request each, exact for
 * that commit). Any position is a checkpoint plus the diffs after it, and the
 * projection says honestly how many diffs were missing.
 *
 * Sequential playback is the common case, so results are cached and each step
 * forward reuses the previous one.
 */
export class TreeProjector {
  #commits: readonly Commit[] = [];
  #snapshots = new Map<string, RepoTree>();
  #details = new Map<string, CommitDetail>();
  #cache = new Lru<number, CacheEntry>(48);
  /** Sorted commit indices that have a tree snapshot. */
  #snapshotIndices: number[] = [];

  setCommits(commits: readonly Commit[]): void {
    this.#commits = commits;
    this.#reindexSnapshots();
    this.#cache.clear();
  }

  addSnapshot(sha: string, tree: RepoTree): void {
    this.#snapshots.set(sha, tree);
    this.#reindexSnapshots();
    this.#cache.clear();
  }

  addDetail(sha: string, detail: CommitDetail): void {
    this.#details.set(sha, detail);
    const index = this.#commits.findIndex((c) => c.sha === sha);
    if (index === -1) return;
    // Everything at or after this commit may now be more accurate.
    for (const key of this.#cache.keys()) {
      if (key >= index) this.#cache.delete(key);
    }
  }

  hasSnapshot(sha: string): boolean {
    return this.#snapshots.has(sha);
  }

  hasDetail(sha: string): boolean {
    return this.#details.has(sha);
  }

  get snapshotIndices(): readonly number[] {
    return this.#snapshotIndices;
  }

  get detailCount(): number {
    return this.#details.size;
  }

  clear(): void {
    this.#commits = [];
    this.#snapshots.clear();
    this.#details.clear();
    this.#cache.clear();
    this.#snapshotIndices = [];
  }

  #reindexSnapshots(): void {
    const indices: number[] = [];
    for (let i = 0; i < this.#commits.length; i += 1) {
      if (this.#snapshots.has(this.#commits[i]!.sha)) indices.push(i);
    }
    this.#snapshotIndices = indices;
  }

  /** Nearest snapshot at or before `index`, or -1 when none exists. */
  #snapshotAtOrBefore(index: number): number {
    let best = -1;
    for (const candidate of this.#snapshotIndices) {
      if (candidate > index) break;
      best = candidate;
    }
    return best;
  }

  #entry(index: number): CacheEntry {
    const cached = this.#cache.get(index);
    if (cached) return cached;

    const snapshotIndex = this.#snapshotAtOrBefore(index);

    // Find the cheapest starting point: a cached projection, or the snapshot.
    let startIndex = snapshotIndex;
    let start: CacheEntry | null = null;
    for (const key of this.#cache.keys()) {
      if (key <= index && key >= startIndex) {
        const candidate = this.#cache.get(key)!;
        if (!start || key > startIndex) {
          startIndex = key;
          start = candidate;
        }
      }
    }

    let files: Map<string, { size: number | null; sha: string | null }>;
    let missing: number;
    let sourceIndex: number;
    let sourceTruncated: boolean;

    if (start) {
      files = new Map(start.files);
      missing = start.missingCommits;
      sourceIndex = start.sourceIndex;
      sourceTruncated = start.sourceTruncated;
    } else if (snapshotIndex >= 0) {
      const tree = this.#snapshots.get(this.#commits[snapshotIndex]!.sha)!;
      files = fileSetFromTree(tree);
      missing = 0;
      sourceIndex = snapshotIndex;
      sourceTruncated = tree.truncated;
      startIndex = snapshotIndex;
    } else {
      files = new Map();
      missing = index + 1;
      sourceIndex = -1;
      sourceTruncated = false;
      startIndex = -1;
    }

    for (let i = startIndex + 1; i <= index; i += 1) {
      const commit = this.#commits[i];
      if (!commit) break;
      // A snapshot on the way is always better than replaying more diffs.
      const snapshotHere = this.#snapshots.get(commit.sha);
      if (snapshotHere) {
        files = fileSetFromTree(snapshotHere);
        missing = 0;
        sourceIndex = i;
        sourceTruncated = snapshotHere.truncated;
        this.#cache.set(i, { files, missingCommits: missing, sourceIndex, sourceTruncated });
        continue;
      }
      const detail = this.#details.get(commit.sha);
      if (!detail) {
        missing += 1;
        continue;
      }
      files = applyFileChanges(files, detail.files).next;
      this.#cache.set(i, { files, missingCommits: missing, sourceIndex, sourceTruncated });
    }

    const entry: CacheEntry = { files, missingCommits: missing, sourceIndex, sourceTruncated };
    this.#cache.set(index, entry);
    return entry;
  }

  project(index: number): Projection {
    const bounded = Math.min(Math.max(index, 0), Math.max(this.#commits.length - 1, 0));
    const commit = this.#commits[bounded];
    if (!commit) {
      return {
        commitIndex: 0,
        files: new Map(),
        changes: new Map(),
        ghosts: [],
        fidelity: 'partial',
        missingCommits: 0,
        sourceIndex: -1,
        sourceTruncated: false,
      };
    }

    const entry = this.#entry(bounded);
    const detail = this.#details.get(commit.sha);
    // `entry.files` already includes this commit; we only need the labels.
    const described = detail ? describeChanges(detail) : { changes: new Map(), ghosts: [] };

    const fidelity: Projection['fidelity'] =
      entry.sourceIndex === bounded ? 'exact' : entry.missingCommits === 0 ? 'derived' : 'partial';

    return {
      commitIndex: bounded,
      files: entry.files,
      changes: described.changes,
      ghosts: described.ghosts,
      fidelity,
      missingCommits: entry.missingCommits,
      sourceIndex: entry.sourceIndex,
      sourceTruncated: entry.sourceTruncated,
    };
  }
}
