/**
 * Domain types. The UI only ever sees these shapes; raw GitHub REST payloads
 * stop at `src/lib/github/adapter.ts`.
 */

export type RateLimitSnapshot = {
  limit: number;
  remaining: number;
  /** Unix seconds. */
  resetAt: number;
  /** True when the request that produced this snapshot was authenticated. */
  authenticated: boolean;
};

/**
 * Where a repository's data came from. Set by the server, never inferred from a
 * label, so the UI can be certain which mode it is in.
 */
export type DataSource = 'builtin' | 'github';

export type RepoMeta = {
  /** `builtin` for the curated demo, `github` for a real repository. */
  dataSource: DataSource;
  owner: string;
  repo: string;
  slug: string;
  description: string | null;
  defaultBranch: string;
  /** Null for built-in data: there is no real repository to link to. */
  htmlUrl: string | null;
  createdAt: string;
  pushedAt: string;
  /** GitHub's own guess at the primary language; may be null for empty repos. */
  primaryLanguage: string | null;
  stars: number;
  forks: number;
  /** Repository size in kilobytes, as reported by GitHub. */
  sizeKb: number;
  license: string | null;
  topics: string[];
  isArchived: boolean;
  isFork: boolean;
  isEmpty: boolean;
};

export type CommitAuthor = {
  name: string;
  /** GitHub login when the commit is linked to an account. */
  login: string | null;
  avatarUrl: string | null;
  date: string;
};

export type Commit = {
  sha: string;
  shortSha: string;
  /** First line of the commit message. */
  subject: string;
  /** Everything after the first blank line, trimmed. Empty string when absent. */
  body: string;
  author: CommitAuthor;
  committerDate: string;
  parents: string[];
  /** Null for built-in data: there is no real commit to link to. */
  htmlUrl: string | null;
  /** Index within the loaded range, 0 = oldest loaded commit. */
  index: number;
};

export type FileChangeStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export type FileChange = {
  path: string;
  previousPath: string | null;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunk text, already length-capped. Null when GitHub omitted it. */
  patch: string | null;
  /** Why `patch` is null, so the UI can explain itself instead of showing a blank box. */
  patchOmittedReason: 'binary' | 'too-large' | 'not-provided' | null;
  /** True when we truncated a patch GitHub did provide. */
  patchTruncated: boolean;
  blobUrl: string | null;
};

export type CommitDetail = {
  sha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: FileChange[];
  /** GitHub caps the file list at 300 entries per commit. */
  filesTruncated: boolean;
};

export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree';
  size: number | null;
  sha: string;
};

export type RepoTree = {
  /** Commit sha this tree was read at. */
  commitSha: string;
  entries: TreeEntry[];
  /** GitHub truncates recursive trees above ~100k entries or 7MB. */
  truncated: boolean;
};

export type CommitPage = {
  commits: Commit[];
  /** Total commits on the default branch, or null when it could not be determined. */
  totalCommits: number | null;
  /** True when older commits exist beyond what is loaded. */
  hasOlder: boolean;
  /** Highest page number fetched so far (1-based, 100 per page). */
  pagesLoaded: number;
};

export type Tag = {
  name: string;
  sha: string;
};

export type LoadedRange = {
  /** Number of commits currently loaded. */
  count: number;
  /** Total commits on the branch, when known. */
  total: number | null;
  /** True when the loaded range starts at the repository's first commit. */
  reachesFirstCommit: boolean;
  oldestSha: string | null;
  newestSha: string | null;
  oldestDate: string | null;
  newestDate: string | null;
};
