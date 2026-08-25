import type { RawCommitDetail, RawCommitFile, RawCommitListItem, RawRepo, RawTag, RawTree } from './raw-types';

/**
 * Shapes and helpers shared by the server-side fixture provider and the
 * in-process fake used by the unit tests, so both serve identical data.
 */

/** Only what a commit-detail response adds over the list response. */
export type FixtureCommitDetail = {
  sha: string;
  stats: { additions: number; deletions: number; total: number } | null;
  files: RawCommitFile[];
};

export type FixtureBundle = {
  repo: RawRepo;
  /** Newest-first, matching GitHub's ordering. */
  commits: RawCommitListItem[];
  commitDetail: Record<string, FixtureCommitDetail>;
  /** Trees recorded at a handful of commits; others are derived from these. */
  tree: Record<string, RawTree>;
  tags: RawTag[];
};

/** Rebuilds a full commit-detail response from the list item plus the recorded diff. */
export function fixtureCommitDetail(bundle: FixtureBundle, sha: string): RawCommitDetail | null {
  const detail = bundle.commitDetail[sha];
  const commit = bundle.commits.find((item) => item.sha === sha);
  if (!detail || !commit) return null;
  return { ...commit, stats: detail.stats, files: detail.files };
}

/**
 * A tree for any commit in the bundle.
 *
 * Recorded trees are used directly. Anything else is rebuilt from the nearest
 * recorded tree at or before that commit plus the recorded diffs in between —
 * the same reconstruction the client performs, done here so fixture mode can
 * answer every request the application makes without shipping one tree per
 * commit.
 */
export function fixtureTree(bundle: FixtureBundle, sha: string): RawTree | null {
  const recorded = bundle.tree[sha];
  if (recorded) return recorded;

  const oldestFirst = [...bundle.commits].reverse();
  const target = oldestFirst.findIndex((commit) => commit.sha === sha);
  if (target === -1) return null;

  let baseIndex = -1;
  for (let i = target; i >= 0; i -= 1) {
    if (bundle.tree[oldestFirst[i]!.sha]) {
      baseIndex = i;
      break;
    }
  }
  if (baseIndex === -1) return null;

  const base = bundle.tree[oldestFirst[baseIndex]!.sha]!;
  const blobs = new Map(base.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry]));

  for (let i = baseIndex + 1; i <= target; i += 1) {
    const detail = bundle.commitDetail[oldestFirst[i]!.sha];
    if (!detail) return null; // an unrecorded diff would make the answer a guess
    for (const file of detail.files) {
      switch (file.status) {
        case 'removed':
          blobs.delete(file.filename);
          break;
        case 'renamed':
          if (file.previous_filename) blobs.delete(file.previous_filename);
          blobs.set(file.filename, synthetic(file.filename));
          break;
        case 'added':
        case 'copied':
          blobs.set(file.filename, synthetic(file.filename));
          break;
        default:
          if (!blobs.has(file.filename)) blobs.set(file.filename, synthetic(file.filename));
          break;
      }
    }
  }

  const directories = new Set<string>();
  for (const path of blobs.keys()) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
  }

  return {
    sha: `derived-${sha}`,
    truncated: false,
    tree: [
      ...[...directories].map((path) => ({ path, mode: '040000', type: 'tree', sha: hash(path) })),
      ...blobs.values(),
    ],
  };
}

function synthetic(path: string): RawTree['tree'][number] {
  // Size is unknown for a file we only learned about from a diff, which is
  // exactly what the real application sees in the same situation.
  return { path, mode: '100644', type: 'blob', sha: hash(path) };
}

function hash(seed: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    for (const char of `${seed}:${i}`) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}
