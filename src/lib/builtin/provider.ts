import { compareLocalHistory, resolveLocalSha } from '@/lib/compare/local';
import type {
  Commit,
  CommitDetail,
  FileChange,
  RepoCompare,
  RepoMeta,
  RepoTree,
  Tag,
  TreeEntry,
} from '@/lib/domain/types';
import type { RepoRef } from '@/lib/repo-ref';
import { diffText } from '@/lib/diff/unified';
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

/**
 * `demo` is an internal namespace, not a GitHub account.
 *
 * Exactly one reference in it resolves — the built-in demo. Anything else is a
 * reference to a repository that cannot exist, so asking GitHub about it would
 * spend quota to be told what we already know.
 */
export function isReservedDemoOwner(owner: string): boolean {
  return owner.trim().toLowerCase() === BUILTIN_DEMO_OWNER;
}

/**
 * True when a reference lives in the reserved namespace but is not the built-in
 * demo, i.e. it must be refused locally.
 */
export function isUnknownBuiltinRef(ref: Pick<RepoRef, 'owner' | 'slug'>): boolean {
  return isReservedDemoOwner(ref.owner) && !isBuiltinRef(ref);
}

export const BUILTIN_DEMO_REF: RepoRef = {
  owner: BUILTIN_DEMO_OWNER,
  repo: BUILTIN_DEMO_REPO,
  slug: BUILTIN_DEMO_SLUG,
};

// ---------------------------------------------------------------- helpers ---

/** Deterministic 32-bit hash, so ids are stable across runs and processes. */
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

/** UTF-8 byte length, which is what a file size means. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * One file as the demo holds it at one commit.
 *
 * `text` is null for the two files whose content is deliberately not shipped;
 * their size is declared by the fixture instead, and the interface says so.
 */
type FileState = {
  text: string | null;
  size: number;
  /**
   * Blob id. Derived from the content for a text file, so two commits holding
   * the same bytes get the same id and a comparison between them correctly
   * reports no change. Declared files fall back to a revision counter.
   */
  blobSha: string;
  declaredLines: number | null;
};

// ------------------------------------------------------------------ build ---

type BuiltDemo = {
  meta: RepoMeta;
  /** Oldest first, `index` assigned. */
  commits: Commit[];
  details: Map<string, CommitDetail>;
  trees: Map<string, RepoTree>;
  tags: Tag[];
  /** Content at every commit, so a comparison can diff two arbitrary points. */
  contents: Map<string, Map<string, FileState>>;
};

function textState(text: string): FileState {
  return {
    text,
    size: byteLength(text),
    // Content-addressed, exactly as Git is: the id follows the bytes.
    blobSha: hexId(`content:${text}`),
    declaredLines: null,
  };
}

function declaredState(path: string, lines: number, bytes: number, revision: number): FileState {
  return {
    text: null,
    size: bytes,
    blobSha: hexId(`declared:${path}:${revision}`),
    declaredLines: lines,
  };
}

function treeFrom(commitSha: string, files: ReadonlyMap<string, FileState>): RepoTree {
  const entries: TreeEntry[] = [];
  const directories = new Set<string>();

  for (const [path, state] of files) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
    entries.push({ path, type: 'blob', size: state.size, sha: state.blobSha });
  }

  for (const directory of directories) {
    entries.push({ path: directory, type: 'tree', size: null, sha: hexId(`tree:${directory}`) });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { commitSha, entries, truncated: false };
}

/**
 * Replays the fixture into the same domain objects the GitHub adapter produces,
 * so every downstream module — projector, statistics, milestones, panels,
 * comparison — runs unchanged.
 *
 * Every number a file reports is computed here from its content: the patch by
 * diffing the previous revision against the new one, the line counts from that
 * patch, the size from the bytes, and the blob id from the bytes. A hand-written
 * count cannot drift from a hand-written hunk, because neither is written by hand.
 *
 * The tree is materialised at every commit, so no position is ever an
 * approximation and no comparison has to be reconstructed from diffs.
 */
function build(): BuiltDemo {
  const commits: Commit[] = [];
  const details = new Map<string, CommitDetail>();
  const trees = new Map<string, RepoTree>();
  const contents = new Map<string, Map<string, FileState>>();
  const files = new Map<string, FileState>();
  /** Revision counter per declared path, so its id changes when it changes. */
  const revisions = new Map<string, number>();

  DEMO_COMMITS.forEach((spec, index) => {
    const changes: FileChange[] = [];

    for (const op of spec.files) {
      switch (op.op) {
        case 'add':
        case 'mod': {
          const before = files.get(op.path)?.text ?? '';
          const diff = diffText(before, op.text);
          files.set(op.path, textState(op.text));
          changes.push({
            path: op.path,
            previousPath: null,
            status: op.op === 'add' ? 'added' : 'modified',
            additions: diff.additions,
            deletions: diff.deletions,
            patch: diff.patch,
            patchOmittedReason: null,
            patchTruncated: false,
            blobUrl: null,
          });
          break;
        }

        case 'ren': {
          const previous = files.get(op.from);
          const before = previous?.text ?? '';
          const after = op.text ?? before;
          files.delete(op.from);
          files.set(op.path, textState(after));
          const diff = diffText(before, after);
          changes.push({
            path: op.path,
            previousPath: op.from,
            status: 'renamed',
            additions: diff.additions,
            deletions: diff.deletions,
            // A pure rename has an empty diff, which is a fact about the change
            // rather than a missing patch, so it says so explicitly.
            patch: diff.patch === '' ? null : diff.patch,
            patchOmittedReason: diff.patch === '' ? 'rename-only' : null,
            patchTruncated: false,
            blobUrl: null,
          });
          break;
        }

        case 'del': {
          const previous = files.get(op.path);
          files.delete(op.path);
          const diff = diffText(previous?.text ?? '', '');
          changes.push({
            path: op.path,
            previousPath: null,
            status: 'removed',
            additions: diff.additions,
            deletions: diff.deletions,
            patch: previous?.text === null ? null : diff.patch,
            patchOmittedReason: previous?.text === null ? 'generated' : null,
            patchTruncated: false,
            blobUrl: null,
          });
          break;
        }

        case 'opaque': {
          const revision = (revisions.get(op.path) ?? 0) + 1;
          revisions.set(op.path, revision);
          files.set(op.path, declaredState(op.path, op.lines, op.bytes, revision));
          changes.push({
            path: op.path,
            previousPath: null,
            status: 'added',
            additions: op.lines,
            deletions: 0,
            patch: null,
            patchOmittedReason: op.reason,
            patchTruncated: false,
            blobUrl: null,
          });
          break;
        }

        case 'opaqueMod': {
          const revision = (revisions.get(op.path) ?? 0) + 1;
          revisions.set(op.path, revision);
          files.set(op.path, declaredState(op.path, op.lines, op.bytes, revision));
          changes.push({
            path: op.path,
            previousPath: null,
            status: 'modified',
            additions: op.added,
            deletions: op.removed,
            patch: null,
            patchOmittedReason: 'generated',
            patchTruncated: false,
            blobUrl: null,
          });
          break;
        }
      }
    }

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
      additions: changes.reduce((sum, file) => sum + file.additions, 0),
      deletions: changes.reduce((sum, file) => sum + file.deletions, 0),
      changedFiles: changes.length,
      files: changes,
      filesTruncated: false,
    });

    trees.set(spec.sha, treeFrom(spec.sha, files));
    contents.set(spec.sha, new Map(files));
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
    sizeKb: Math.round([...files.values()].reduce((sum, file) => sum + file.size, 0) / 1024),
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

  return { meta, commits, details, trees, tags, contents };
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
    const touched = spec.files.some(
      (op) => op.path === path || (op.op === 'ren' && op.from === path),
    );
    if (touched) return spec.sha;
  }
  return null;
}

/** Resolves a full or abbreviated sha to a demo commit, or null. */
export function builtinResolveSha(sha: string): Commit | null {
  return resolveLocalSha(demo().commits, sha);
}

/**
 * Compares two points of the demo, entirely locally.
 *
 * The demo stores a full tree at every commit, so the shared comparison takes
 * its exact branch: the net difference is read off the two trees rather than
 * replayed from diffs, which stays correct however many times a file was touched
 * in between.
 */
export function builtinCompare(baseSha: string, headSha: string): RepoCompare | null {
  const built = demo();
  return compareLocalHistory(
    {
      commits: built.commits,
      snapshotAt: (sha) => blobMap(built.trees.get(sha)),
      detailOf: (sha) => built.details.get(sha) ?? null,
      tagOf: (sha) => built.tags.find((tag) => tag.sha === sha)?.name ?? null,
      // The demo holds every file at every commit, so the net difference between
      // any two points is computed from the content rather than reassembled.
      contentAt: (sha, path) => {
        const at = built.contents.get(sha);
        if (!at) return undefined;
        const state = at.get(path);
        return state ? state.text : undefined;
      },
    },
    baseSha,
    headSha,
  );
}

/** path -> blob id for one tree, or null when the tree is unknown. */
function blobMap(tree: RepoTree | undefined): Map<string, string> | null {
  if (!tree) return null;
  const out = new Map<string, string>();
  for (const entry of tree.entries) {
    if (entry.type === 'blob') out.set(entry.path, entry.sha);
  }
  return out;
}

/** Test seam. */
export function resetBuiltinCache(): void {
  cached = null;
}
