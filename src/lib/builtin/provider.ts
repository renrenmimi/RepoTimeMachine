import type {
  Commit,
  CommitDetail,
  FileChange,
  RepoMeta,
  RepoTree,
  Tag,
  TreeEntry,
} from '@/lib/domain/types';
import type { RepoRef } from '@/lib/repo-ref';
import {
  BUILTIN_DEMO_AUTHOR,
  BUILTIN_DEMO_BRANCH,
  BUILTIN_DEMO_DESCRIPTION,
  BUILTIN_DEMO_OWNER,
  BUILTIN_DEMO_REPO,
  BUILTIN_DEMO_SLUG,
  DEMO_COMMITS,
  DEMO_CREATED_AT,
  DEMO_PUSHED_AT,
  DEMO_TAGS,
  type DemoChange,
} from './learning-platform';

/**
 * Serves the built-in demo from the fixture in `learning-platform.ts`.
 *
 * The point of this module is that it is the *only* thing that answers for
 * `demo/learning-platform`, and it never touches the network. It runs in
 * production, unlike the test-fixture provider, and it is scoped to that one
 * reference: anything else falls through to the normal GitHub path, so an
 * arbitrary `demo/whatever` gets the ordinary not-found behaviour.
 */

/** True only for the exact built-in reference. */
export function isBuiltinRef(ref: Pick<RepoRef, 'slug'>): boolean {
  return ref.slug.toLowerCase() === BUILTIN_DEMO_SLUG;
}

export function isBuiltinSlug(slug: string): boolean {
  return slug.trim().toLowerCase() === BUILTIN_DEMO_SLUG;
}

export const BUILTIN_DEMO_REF: RepoRef = {
  owner: BUILTIN_DEMO_OWNER,
  repo: BUILTIN_DEMO_REPO,
  slug: BUILTIN_DEMO_SLUG,
};

// ---------------------------------------------------------------- helpers ---

/** Deterministic 32-bit hash, so sizes and blob ids are stable across runs. */
function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 40-character hex, used for synthetic blob and tree ids. */
function hexId(seed: string): string {
  let out = '';
  for (let i = 0; out.length < 40; i += 1) {
    out += hash32(`${seed}#${i}`).toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

/** A plausible starting size for a path, before any edits. */
function baseSize(path: string): number {
  return 180 + (hash32(path) % 5200);
}

type BlobState = { size: number; revision: number };

// ------------------------------------------------------------------ build ---

type BuiltDemo = {
  meta: RepoMeta;
  /** Oldest first, `index` assigned. */
  commits: Commit[];
  details: Map<string, CommitDetail>;
  trees: Map<string, RepoTree>;
  tags: Tag[];
};

function toFileChange(change: DemoChange): FileChange {
  return {
    path: change.path,
    previousPath: change.from ?? null,
    status: change.kind,
    additions: change.additions,
    deletions: change.deletions,
    patch: change.patch ?? null,
    // A change with no recorded diff says so, exactly as the GitHub path does.
    patchOmittedReason: change.patch ? null : 'not-provided',
    patchTruncated: false,
    blobUrl: null,
  };
}

function treeFrom(commitSha: string, blobs: ReadonlyMap<string, BlobState>): RepoTree {
  const entries: TreeEntry[] = [];
  const directories = new Set<string>();

  for (const [path, state] of blobs) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
    entries.push({
      path,
      type: 'blob',
      size: state.size,
      sha: hexId(`blob:${path}:${state.revision}`),
    });
  }

  for (const directory of directories) {
    entries.push({ path: directory, type: 'tree', size: null, sha: hexId(`tree:${directory}`), });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { commitSha, entries, truncated: false };
}

/**
 * Replays the fixture into the same domain objects the GitHub adapter produces,
 * so every downstream module — projector, statistics, milestones, panels — runs
 * unchanged. The tree is materialised at every commit, so no position is ever an
 * approximation.
 */
function build(): BuiltDemo {
  const commits: Commit[] = [];
  const details = new Map<string, CommitDetail>();
  const trees = new Map<string, RepoTree>();
  const blobs = new Map<string, BlobState>();

  DEMO_COMMITS.forEach((spec, index) => {
    for (const change of spec.changes) {
      switch (change.kind) {
        case 'added': {
          blobs.set(change.path, {
            size: baseSize(change.path) + change.additions * 6,
            revision: 1,
          });
          break;
        }
        case 'removed': {
          blobs.delete(change.path);
          break;
        }
        case 'renamed': {
          const previous = change.from ? blobs.get(change.from) : undefined;
          if (change.from) blobs.delete(change.from);
          blobs.set(change.path, {
            size: Math.max(40, (previous?.size ?? baseSize(change.path)) + (change.additions - change.deletions) * 6),
            revision: (previous?.revision ?? 0) + 1,
          });
          break;
        }
        default: {
          const current = blobs.get(change.path);
          blobs.set(change.path, {
            size: Math.max(40, (current?.size ?? baseSize(change.path)) + (change.additions - change.deletions) * 6),
            revision: (current?.revision ?? 0) + 1,
          });
          break;
        }
      }
    }

    const files = spec.changes.map(toFileChange);
    commits.push({
      sha: spec.sha,
      shortSha: spec.sha.slice(0, 7),
      subject: spec.subject,
      body: spec.body,
      author: {
        name: BUILTIN_DEMO_AUTHOR,
        login: null,
        avatarUrl: null,
        date: spec.date,
      },
      committerDate: spec.date,
      parents: index === 0 ? [] : [DEMO_COMMITS[index - 1]!.sha],
      htmlUrl: null,
      index,
    });

    details.set(spec.sha, {
      sha: spec.sha,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      changedFiles: files.length,
      files,
      filesTruncated: false,
    });

    trees.set(spec.sha, treeFrom(spec.sha, blobs));
  });

  const meta: RepoMeta = {
    dataSource: 'builtin',
    owner: BUILTIN_DEMO_OWNER,
    repo: BUILTIN_DEMO_REPO,
    slug: BUILTIN_DEMO_SLUG,
    description: BUILTIN_DEMO_DESCRIPTION,
    defaultBranch: BUILTIN_DEMO_BRANCH,
    htmlUrl: null,
    createdAt: DEMO_CREATED_AT,
    pushedAt: DEMO_PUSHED_AT,
    primaryLanguage: 'TypeScript',
    stars: 0,
    forks: 0,
    sizeKb: Math.round([...blobs.values()].reduce((sum, blob) => sum + blob.size, 0) / 1024),
    license: 'MIT',
    topics: [],
    isArchived: false,
    isFork: false,
    isEmpty: false,
  };

  const tags: Tag[] = DEMO_TAGS.map((tag) => ({
    name: tag.name,
    sha: DEMO_COMMITS[tag.commitIndex]!.sha,
  }));

  return { meta, commits, details, trees, tags };
}

let cached: BuiltDemo | null = null;

function demo(): BuiltDemo {
  cached ??= build();
  return cached;
}

// -------------------------------------------------------------------- api ---

export function builtinRepoMeta(): RepoMeta {
  return demo().meta;
}

export function builtinCommitCount(): number {
  return demo().commits.length;
}

/** One page of commits, newest first, matching the GitHub listing contract. */
export function builtinCommitPage(page: number, perPage: number) {
  const newestFirst = [...demo().commits].reverse();
  const start = (page - 1) * perPage;
  const slice = newestFirst.slice(start, start + perPage);
  return {
    commits: slice.map((commit, i) => ({ ...commit, index: start + i })),
    hasOlder: start + slice.length < newestFirst.length,
    totalCommits: newestFirst.length,
  };
}

export function builtinCommitDetail(sha: string): CommitDetail | null {
  return demo().details.get(sha) ?? null;
}

export function builtinTree(sha: string): RepoTree | null {
  return demo().trees.get(sha) ?? null;
}

export function builtinTags(): Tag[] {
  return demo().tags;
}

/** The oldest commit that touched a path, for the milestone path probes. */
export function builtinFirstCommitForPath(path: string): string | null {
  for (const spec of DEMO_COMMITS) {
    if (spec.changes.some((change) => change.path === path || change.from === path)) return spec.sha;
  }
  return null;
}

/** Test seam. */
export function resetBuiltinCache(): void {
  cached = null;
}
