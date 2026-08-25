import type {
  Commit,
  CommitDetail,
  FileChange,
  FileChangeStatus,
  RepoMeta,
  RepoTree,
  Tag,
  TreeEntry,
} from '@/lib/domain/types';
import type {
  RawCommitDetail,
  RawCommitFile,
  RawCommitListItem,
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

export function toRepoMeta(raw: RawRepo, isEmpty: boolean): RepoMeta {
  return {
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

export function toCommitDetail(raw: RawCommitDetail): CommitDetail {
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const budget = { left: MAX_COMMIT_PATCH_CHARS };
  const files = rawFiles.slice(0, MAX_COMMIT_FILES).map((file) => toFileChange(file, budget));
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
