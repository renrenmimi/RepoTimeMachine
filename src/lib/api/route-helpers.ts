import 'server-only';

import type { ApiFailure, ApiSuccess } from '@/lib/api/contract';
import { GitHubError, isGitHubError } from '@/lib/github/errors';
import { hasToken } from '@/lib/github/client';
import { readRateLimit } from '@/lib/github/rate-limit-store';
import { isValidRefName, isValidSha, parseRepoRef, type RepoRef } from '@/lib/repo-ref';

/** Longest path we will forward to a path-scoped commit query. */
const MAX_PROBE_PATH = 200;

/** Anything outside this set has no business in a repository-relative path. */
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._\-/+@ ()[\]]+$/;

export function readRepoRef(params: URLSearchParams): RepoRef {
  const owner = params.get('owner') ?? '';
  const repo = params.get('repo') ?? '';
  const parsed = parseRepoRef(`${owner}/${repo}`);
  if (!parsed.ok) throw new GitHubError('invalid-input', parsed.message);
  return parsed.value;
}

export function readBranch(params: URLSearchParams, fallback = 'HEAD'): string {
  const branch = params.get('branch');
  if (!branch) return fallback;
  if (!isValidRefName(branch)) throw new GitHubError('invalid-input', 'That branch name is not valid.');
  return branch;
}

export function readSha(params: URLSearchParams): string {
  const sha = (params.get('sha') ?? '').toLowerCase();
  if (!isValidSha(sha)) throw new GitHubError('invalid-input', 'A commit sha is required.');
  return sha;
}

export function readPage(params: URLSearchParams): number {
  const raw = Number(params.get('page') ?? '1');
  if (!Number.isFinite(raw) || raw < 1) throw new GitHubError('invalid-input', 'Page must be a positive integer.');
  return Math.floor(raw);
}

export function readProbePath(params: URLSearchParams): string {
  const value = params.get('path') ?? '';
  if (!value || value.length > MAX_PROBE_PATH) {
    throw new GitHubError('invalid-input', 'A repository-relative file path is required.');
  }
  // Only paths that could plausibly exist inside a repository, so nothing can
  // escape the `?path=` query parameter into another API surface.
  if (value.startsWith('/') || value.includes('..') || !SAFE_PATH_PATTERN.test(value)) {
    throw new GitHubError('invalid-input', 'That file path is not valid.');
  }
  return value;
}

export function ok<T>(data: T, cacheSeconds: number): Response {
  const { snapshot, ageMs } = readRateLimit();
  const body: ApiSuccess<T> = { data, rateLimit: snapshot, rateLimitAgeMs: ageMs };
  const directive = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`;
  return Response.json(body, {
    headers: {
      'Cache-Control': directive,
      // Vercel normalises `Cache-Control` on route handlers, so the CDN needs
      // to be told separately. Other hosts read the standard header above.
      'CDN-Cache-Control': directive,
      'Vercel-CDN-Cache-Control': directive,
    },
  });
}

export function fail(error: unknown): Response {
  const githubError = isGitHubError(error)
    ? error
    : new GitHubError('unknown', 'Something went wrong while talking to GitHub.');
  const { snapshot, ageMs } = readRateLimit();
  const body: ApiFailure = {
    error: {
      code: githubError.code,
      message: githubError.message,
      retryAt: githubError.retryAt,
    },
    rateLimit: githubError.rateLimit ?? snapshot,
    rateLimitAgeMs: githubError.rateLimit ? 0 : ageMs,
  };
  return Response.json(body, {
    status: githubError.status,
    headers: {
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    },
  });
}

export { hasToken };
