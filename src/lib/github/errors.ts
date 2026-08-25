import type { RateLimitSnapshot } from '@/lib/domain/types';

export type GitHubErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'empty-repository'
  | 'rate-limited'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'upstream'
  | 'too-large'
  | 'unknown';

/**
 * A failure that is safe to show to a visitor. `message` never contains the
 * token, request headers, or anything else from the server environment.
 */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number;
  readonly rateLimit: RateLimitSnapshot | null;
  /** Unix seconds when the rate limit window resets, for `rate-limited` only. */
  readonly retryAt: number | null;

  constructor(
    code: GitHubErrorCode,
    message: string,
    options: { status?: number; rateLimit?: RateLimitSnapshot | null; retryAt?: number | null } = {},
  ) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.rateLimit = options.rateLimit ?? null;
    this.retryAt = options.retryAt ?? null;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryAt: this.retryAt,
      },
      rateLimit: this.rateLimit,
    };
  }
}

function statusForCode(code: GitHubErrorCode): number {
  switch (code) {
    case 'invalid-input':
      return 400;
    case 'not-found':
      return 404;
    case 'empty-repository':
      return 409;
    case 'rate-limited':
      return 429;
    case 'forbidden':
      return 403;
    case 'timeout':
      return 504;
    case 'too-large':
      return 413;
    case 'network':
    case 'upstream':
    case 'unknown':
    default:
      return 502;
  }
}

export function isGitHubError(value: unknown): value is GitHubError {
  return value instanceof GitHubError;
}
