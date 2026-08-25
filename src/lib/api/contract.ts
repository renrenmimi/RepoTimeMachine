import type {
  Commit,
  CommitDetail,
  RateLimitSnapshot,
  RepoMeta,
  RepoTree,
  Tag,
} from '@/lib/domain/types';
import type { GitHubErrorCode } from '@/lib/github/errors';

/** Every route responds with this envelope, success or failure. */
export type ApiSuccess<T> = {
  data: T;
  rateLimit: RateLimitSnapshot | null;
  /** Milliseconds since the rate-limit snapshot was observed, or null. */
  rateLimitAgeMs: number | null;
};

export type ApiFailure = {
  error: {
    code: GitHubErrorCode;
    message: string;
    /** Unix seconds, for rate-limit errors. */
    retryAt: number | null;
  };
  rateLimit: RateLimitSnapshot | null;
  rateLimitAgeMs: number | null;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return 'error' in response;
}

export type RepoPayload = {
  meta: RepoMeta;
  /** True when a server-side token is configured. Never reveals the token itself. */
  tokenConfigured: boolean;
};

export type CommitsPayload = {
  /** Newest-first, exactly as GitHub returns them. The client reverses and indexes. */
  commits: Commit[];
  page: number;
  perPage: number;
  /** True when GitHub advertised a next (older) page. */
  hasOlder: boolean;
  /** Exact commit count on the branch, when it could be determined cheaply. */
  totalCommits: number | null;
  branch: string;
};

export type CommitDetailPayload = { detail: CommitDetail };
export type TreePayload = { tree: RepoTree };
export type TagsPayload = { tags: Tag[] };
export type ProbePayload = {
  /** Path that was queried. */
  path: string;
  /** Sha of the oldest commit that touched the path, or null if unknown. */
  firstSha: string | null;
  /** True when the answer required more pages than we were willing to fetch. */
  incomplete: boolean;
};

export const API_ROUTES = {
  repo: '/api/gh/repo',
  commits: '/api/gh/commits',
  commit: '/api/gh/commit',
  tree: '/api/gh/tree',
  tags: '/api/gh/tags',
  probe: '/api/gh/probe',
} as const;
