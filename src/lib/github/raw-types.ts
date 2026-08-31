/** Minimal structural shapes for the GitHub REST payloads this app reads. */

export type RawRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  html_url: string;
  created_at: string;
  pushed_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  size: number;
  license: { spdx_id?: string | null; name?: string | null } | null;
  topics?: string[] | null;
  archived: boolean;
  fork: boolean;
};

export type RawCommitListItem = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string | null; email?: string | null; date?: string | null } | null;
    committer: { name?: string | null; date?: string | null } | null;
  };
  author: { login?: string | null; avatar_url?: string | null } | null;
  parents: { sha: string }[];
};

export type RawCommitFile = {
  filename: string;
  previous_filename?: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
  blob_url?: string | null;
};

export type RawCommitDetail = RawCommitListItem & {
  stats?: { additions?: number; deletions?: number; total?: number } | null;
  files?: RawCommitFile[] | null;
};

export type RawTreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
};

export type RawTree = {
  sha: string;
  tree: RawTreeEntry[];
  truncated: boolean;
};

export type RawTag = {
  name: string;
  commit: { sha: string };
};

export type RawCompare = {
  html_url?: string | null;
  permalink_url?: string | null;
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  base_commit: RawCommitListItem;
  merge_base_commit?: RawCommitListItem | null;
  commits?: RawCommitListItem[] | null;
  files?: RawCommitFile[] | null;
};
