import type {
  Commit,
  CommitDetail,
  CompareEndpoint,
  CompareStatus,
  FileChange,
  FileChangeStatus,
  RepoCompare,
  RepoMeta,
  RepoTree,
  Tag,
  TreeEntry,
} from '@/lib/domain/types';
import type {
  RawCommitDetail,
  RawCommitFile,
  RawCommitListItem,
  RawCompare,
  RawRepo,
  RawTag,
  RawTree,
} from './raw-types';

/** Per-file patch cap. Long diffs are cut with an explicit marker rather than silently. */
export const MAX_PATCH_CHARS = 12_000;
/** Total patch budget for one commit, so a 300-file commit cannot blow up the response. */
export const MAX_COMMIT_PATCH_CHARS = 240_000;
/** GitHub itself caps a commit's file list at 300; mirror that so the number is not a surprise. */
export const MAX_COMMIT_FILES = 300;
/** …and a comparison's commit list at 250. */
export const MAX_COMPARE_COMMITS = 250;

export function toRepoMeta(raw: RawRepo, isEmpty: boolean): RepoMeta {
  return {
    dataSource: 'github',
    owner: raw.owner.login,
    repo: raw.name,
    slug: raw.full_name,
    description: raw.description,
    defaultBranch: raw.default_branch,
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
    pushedAt: raw.pushed_at ?? raw.created_at,
    primaryLanguage: raw.language,
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    sizeKb: raw.size,
    license: raw.license?.spdx_id && raw.license.spdx_id !== 'NOASSERTION' ? raw.license.spdx_id : (raw.license?.name ?? null),
    topics: Array.isArray(raw.topics) ? raw.topics.slice(0, 12) : [],
    isArchived: raw.archived,
    isFork: raw.fork,
    isEmpty,
  };
}

export function splitMessage(message: string): { subject: string; body: string } {
  const normalised = (message ?? '').replace(/\r\n/g, '\n');
  const newline = normalised.indexOf('\n');
  if (newline === -1) return { subject: normalised.trim(), body: '' };
  return {
    subject: normalised.slice(0, newline).trim(),
    body: normalised.slice(newline + 1).trim(),
  };
}

/**
 * Maps a commit list item. `index` is assigned by the caller once the full
 * loaded range is known, because it is relative to the oldest loaded commit.
 */
export function toCommit(raw: RawCommitListItem, index: number): Commit {
  const { subject, body } = splitMessage(raw.commit.message ?? '');
  const authorDate = raw.commit.author?.date ?? raw.commit.committer?.date ?? new Date(0).toISOString();
  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    subject: subject || '(no commit message)',
    body,
    author: {
      name: raw.commit.author?.name?.trim() || raw.author?.login || 'Unknown',
      login: raw.author?.login ?? null,
      avatarUrl: raw.author?.avatar_url ?? null,
      date: authorDate,
    },
    committerDate: raw.commit.committer?.date ?? authorDate,
    parents: raw.parents?.map((p) => p.sha) ?? [],
    htmlUrl: raw.html_url,
    index,
  };
}

const KNOWN_STATUSES: FileChangeStatus[] = ['added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged'];

export function normaliseStatus(status: string): FileChangeStatus {
  const lower = (status ?? '').toLowerCase() as FileChangeStatus;
  return KNOWN_STATUSES.includes(lower) ? lower : 'modified';
}

function toFileChange(raw: RawCommitFile, budget: { left: number }): FileChange {
  const status = normaliseStatus(raw.status);
  const rawPatch = typeof raw.patch === 'string' ? raw.patch : null;

  let patch: string | null = null;
  let truncated = false;
  let omitted: FileChange['patchOmittedReason'] = null;

  if (rawPatch === null) {
    // GitHub omits `patch` for binary blobs and for diffs it considers too large.
    omitted = raw.additions === 0 && raw.deletions === 0 ? 'binary' : 'too-large';
  } else if (budget.left <= 0) {
    omitted = 'too-large';
  } else {
    const perFileCap = Math.min(MAX_PATCH_CHARS, budget.left);
    if (rawPatch.length > perFileCap) {
      patch = rawPatch.slice(0, perFileCap);
      truncated = true;
    } else {
      patch = rawPatch;
    }
    budget.left -= patch.length;
  }

  return {
    path: raw.filename,
    previousPath: raw.previous_filename ?? null,
    status,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    patch,
    patchOmittedReason: omitted,
    patchTruncated: truncated,
    blobUrl: raw.blob_url ?? null,
  };
}

/**
 * Maps a file list under one shared patch budget, so neither a commit nor a
 * comparison can produce an unbounded response.
 */
function toFileChanges(rawFiles: readonly RawCommitFile[]): FileChange[] {
  const budget = { left: MAX_COMMIT_PATCH_CHARS };
  return rawFiles.slice(0, MAX_COMMIT_FILES).map((file) => toFileChange(file, budget));
}

export function toCommitDetail(raw: RawCommitDetail): CommitDetail {
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const files = toFileChanges(rawFiles);
  return {
    sha: raw.sha,
    additions: raw.stats?.additions ?? files.reduce((sum, f) => sum + f.additions, 0),
    deletions: raw.stats?.deletions ?? files.reduce((sum, f) => sum + f.deletions, 0),
    changedFiles: rawFiles.length,
    files,
    filesTruncated: rawFiles.length >= MAX_COMMIT_FILES,
  };
}

export function toRepoTree(raw: RawTree, commitSha: string): RepoTree {
  const entries: TreeEntry[] = [];
  for (const entry of raw.tree ?? []) {
    if (entry.type !== 'blob' && entry.type !== 'tree') continue; // skip submodules (commit) and symlinks we cannot resolve
    entries.push({
      path: entry.path,
      type: entry.type,
      size: typeof entry.size === 'number' ? entry.size : null,
      sha: entry.sha,
    });
  }
  return { commitSha, entries, truncated: Boolean(raw.truncated) };
}

export function toTags(raw: RawTag[]): Tag[] {
  return (raw ?? []).map((tag) => ({ name: tag.name, sha: tag.commit.sha }));
}

const COMPARE_STATUSES: CompareStatus[] = ['identical', 'ahead', 'behind', 'diverged'];

export function normaliseCompareStatus(status: string): CompareStatus {
  const lower = (status ?? '').toLowerCase() as CompareStatus;
  // An unrecognised value is reported as diverged rather than guessed at, because
  // "we do not know how these relate" is closer to diverged than to identical.
  return COMPARE_STATUSES.includes(lower) ? lower : 'diverged';
}

/** Builds an endpoint description from a commit, tagging it if a name was given. */
export function toCompareEndpoint(
  commit: Pick<Commit, 'sha' | 'shortSha' | 'subject' | 'htmlUrl'> & { author: { name: string; date: string } },
  tagName: string | null,
): CompareEndpoint {
  return {
    kind: tagName ? 'tag' : 'commit',
    tagName,
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    authorName: commit.author.name,
    date: commit.author.date,
    htmlUrl: commit.htmlUrl,
  };
}

/**
 * Maps GitHub's compare response.
 *
 * The endpoint answers most of the question in one request: how the two points
 * relate, the commits between them, and the net per-file difference. Both lists
 * are capped by GitHub, so both truncation flags are reported rather than
 * quietly dropped.
 *
 * One gap has to be filled by the caller. The response describes `base_commit`
 * but has no `head_commit`, and when head is an ancestor of base the commit list
 * is empty — so there is nothing in the payload to describe head with. The
 * caller passes `headCommit` for exactly that case.
 */
export function toRepoCompare(
  raw: RawCompare,
  options: {
    /** Sha the caller asked about, used when the payload cannot identify head. */
    requestedHeadSha: string;
    /** Head's own commit record, when the caller had to look it up separately. */
    headCommit?: Commit | null;
    labels: { base: string | null; head: string | null };
  },
): RepoCompare {
  const rawCommits = Array.isArray(raw.commits) ? raw.commits : [];
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];

  // Oldest first, matching the timeline's ordering everywhere else.
  const commits = rawCommits.map((item, index) => toCommit(item, index));
  const files = toFileChanges(rawFiles);

  const baseCommit = toCommit(raw.base_commit, 0);
  const last = commits[commits.length - 1];
  const headFromList = last && last.sha.startsWith(options.requestedHeadSha.toLowerCase()) ? last : null;
  const head = headFromList ?? options.headCommit ?? placeholderCommit(options.requestedHeadSha);

  const total = raw.total_commits ?? commits.length;

  return {
    base: toCompareEndpoint(baseCommit, options.labels.base),
    head: toCompareEndpoint(head, options.labels.head),
    status: normaliseCompareStatus(raw.status),
    aheadBy: raw.ahead_by ?? 0,
    behindBy: raw.behind_by ?? 0,
    commits,
    commitsTruncated: total > commits.length,
    files,
    filesTruncated: rawFiles.length >= MAX_COMMIT_FILES,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles: rawFiles.length,
    mergeBaseSha: raw.merge_base_commit?.sha ?? null,
    htmlUrl: raw.html_url ?? raw.permalink_url ?? null,
  };
}

/**
 * A stand-in for a commit we could not describe. The sha is real; everything
 * else is blank rather than invented, and the UI shows the sha alone.
 */
function placeholderCommit(sha: string): Commit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject: '',
    body: '',
    author: { name: '', login: null, avatarUrl: null, date: '' },
    committerDate: '',
    parents: [],
    htmlUrl: null,
    index: 0,
  };
}
