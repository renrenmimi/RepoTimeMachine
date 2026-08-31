import {
  API_ROUTES,
  isApiFailure,
  type ApiFailure,
  type ApiResponse,
  type CommitDetailPayload,
  type CommitsPayload,
  type ComparePayload,
  type ProbePayload,
  type RepoPayload,
  type TagsPayload,
  type TreePayload,
} from '@/lib/api/contract';
import type { RateLimitSnapshot } from '@/lib/domain/types';
import type { RepoRef } from '@/lib/repo-ref';

export type ApiErrorInfo = ApiFailure['error'];

/** Thrown by every fetcher here; carries the code the UI switches on. */
export class ApiError extends Error {
  readonly info: ApiErrorInfo;
  readonly rateLimit: RateLimitSnapshot | null;

  constructor(info: ApiErrorInfo, rateLimit: RateLimitSnapshot | null) {
    super(info.message);
    this.name = 'ApiError';
    this.info = info;
    this.rateLimit = rateLimit;
  }
}

export type RateLimitObserver = (snapshot: RateLimitSnapshot | null, ageMs: number | null) => void;

export type FetchOptions = {
  signal?: AbortSignal;
  onRateLimit?: RateLimitObserver;
};

async function call<T>(path: string, params: Record<string, string>, options: FetchOptions): Promise<T> {
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(`${path}?${query}`, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      { code: 'network', message: 'Could not reach the Repo Time Machine server.', retryAt: null },
      null,
    );
  }

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError({ code: 'upstream', message: 'The server returned an unreadable response.', retryAt: null }, null);
  }

  options.onRateLimit?.(body.rateLimit, body.rateLimitAgeMs);

  if (isApiFailure(body)) throw new ApiError(body.error, body.rateLimit);
  return body.data;
}

export function fetchRepo(ref: RepoRef, options: FetchOptions = {}): Promise<RepoPayload> {
  return call<RepoPayload>(API_ROUTES.repo, { owner: ref.owner, repo: ref.repo }, options);
}

export function fetchCommits(
  ref: RepoRef,
  branch: string,
  page: number,
  options: FetchOptions = {},
): Promise<CommitsPayload> {
  return call<CommitsPayload>(
    API_ROUTES.commits,
    { owner: ref.owner, repo: ref.repo, branch, page: String(page) },
    options,
  );
}

export function fetchCommitDetail(ref: RepoRef, sha: string, options: FetchOptions = {}): Promise<CommitDetailPayload> {
  return call<CommitDetailPayload>(API_ROUTES.commit, { owner: ref.owner, repo: ref.repo, sha }, options);
}

export function fetchTree(ref: RepoRef, sha: string, options: FetchOptions = {}): Promise<TreePayload> {
  return call<TreePayload>(API_ROUTES.tree, { owner: ref.owner, repo: ref.repo, sha }, options);
}

export function fetchTags(ref: RepoRef, options: FetchOptions = {}): Promise<TagsPayload> {
  return call<TagsPayload>(API_ROUTES.tags, { owner: ref.owner, repo: ref.repo }, options);
}

export function fetchProbe(
  ref: RepoRef,
  branch: string,
  path: string,
  options: FetchOptions = {},
): Promise<ProbePayload> {
  return call<ProbePayload>(API_ROUTES.probe, { owner: ref.owner, repo: ref.repo, branch, path }, options);
}

export function fetchCompare(
  ref: RepoRef,
  base: string,
  head: string,
  labels: { base: string | null; head: string | null } = { base: null, head: null },
  options: FetchOptions = {},
): Promise<ComparePayload> {
  return call<ComparePayload>(
    API_ROUTES.compare,
    {
      owner: ref.owner,
      repo: ref.repo,
      base,
      head,
      ...(labels.base ? { baseLabel: labels.base } : {}),
      ...(labels.head ? { headLabel: labels.head } : {}),
    },
    options,
  );
}

export type GitHubApi = {
  fetchRepo: typeof fetchRepo;
  fetchCommits: typeof fetchCommits;
  fetchCommitDetail: typeof fetchCommitDetail;
  fetchTree: typeof fetchTree;
  fetchTags: typeof fetchTags;
  fetchProbe: typeof fetchProbe;
  fetchCompare: typeof fetchCompare;
};

/** The real implementation, injectable so tests can supply fixtures. */
export const browserApi: GitHubApi = {
  fetchRepo,
  fetchCommits,
  fetchCommitDetail,
  fetchTree,
  fetchTags,
  fetchProbe,
  fetchCompare,
};
