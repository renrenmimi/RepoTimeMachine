import 'server-only';

import type { RateLimitSnapshot } from '@/lib/domain/types';
import { GitHubError } from './errors';

/**
 * The only host this application will ever contact. It is a module constant,
 * never a parameter, so no code path can be persuaded to fetch somewhere else.
 */
const GITHUB_API_ORIGIN = 'https://api.github.com';

const REQUEST_TIMEOUT_MS = 12_000;
/** Refuse to buffer absurd payloads; the largest thing we ask for is a recursive tree. */
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export type GitHubRequest = {
  /** Path segments, joined with `/`. Each segment is URL-encoded. */
  segments: string[];
  query?: Record<string, string | number | undefined>;
  /** Seconds passed to Next.js's data cache. Use a long value for sha-addressed data. */
  revalidate: number;
  signal?: AbortSignal;
  /** Custom Accept header, e.g. for the raw README media type. */
  accept?: string;
};

export type GitHubResponse<T> = {
  data: T;
  rateLimit: RateLimitSnapshot | null;
  /** Parsed `Link` header, keyed by `rel`. */
  links: Record<string, string>;
  status: number;
};

function token(): string | undefined {
  const raw = process.env.GITHUB_TOKEN;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasToken(): boolean {
  return token() !== undefined;
}

function buildUrl(request: GitHubRequest): string {
  const path = request.segments.map((segment) => encodeURIComponent(segment)).join('/');
  const url = new URL(`${GITHUB_API_ORIGIN}/${path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function parseRateLimit(headers: Headers, authenticated: boolean): RateLimitSnapshot | null {
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) return null;
  return { limit, remaining, resetAt: reset, authenticated };
}

export function parseLinkHeader(value: string | null): Record<string, string> {
  if (!value) return {};
  const out: Record<string, string> = {};
  for (const part of value.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match) out[match[2]!] = match[1]!;
  }
  return out;
}

/** Extracts the `page` query parameter from a Link header URL. */
export function pageFromLink(link: string | undefined): number | null {
  if (!link) return null;
  try {
    const page = Number(new URL(link).searchParams.get('page'));
    return Number.isFinite(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new GitHubError('too-large', 'GitHub returned a response larger than this app will buffer.');
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new GitHubError('too-large', 'GitHub returned a response larger than this app will buffer.');
  }
  return text;
}

export async function githubFetch<T>(request: GitHubRequest): Promise<GitHubResponse<T>> {
  const auth = token();
  const headers: Record<string, string> = {
    Accept: request.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'repo-time-machine',
  };
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(buildUrl(request), {
      headers,
      signal,
      next: { revalidate: request.revalidate },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new GitHubError('timeout', 'GitHub did not respond in time. Try again in a moment.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GitHubError('timeout', 'The request was cancelled.');
    }
    throw new GitHubError('network', 'Could not reach the GitHub API from the server.');
  }

  const rateLimit = parseRateLimit(response.headers, Boolean(auth));
  const links = parseLinkHeader(response.headers.get('link'));

  if (!response.ok) {
    throw toError(response, rateLimit, await safeBody(response));
  }

  const text = await readCapped(response);
  let data: T;
  try {
    data = text.length === 0 ? (null as T) : (JSON.parse(text) as T);
  } catch {
    throw new GitHubError('upstream', 'GitHub returned a response this app could not read.');
  }

  return { data, rateLimit, links, status: response.status };
}

async function safeBody(response: Response): Promise<{ message?: string }> {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message?: unknown }).message;
      return { message: typeof message === 'string' ? message : undefined };
    }
    return {};
  } catch {
    return {};
  }
}

function toError(
  response: Response,
  rateLimit: RateLimitSnapshot | null,
  body: { message?: string },
): GitHubError {
  const status = response.status;
  const upstream = body.message ?? '';

  if (status === 404) {
    return new GitHubError(
      'not-found',
      'That repository could not be found. It may be private, renamed, or misspelled — Repo Time Machine only reads public repositories.',
      { status, rateLimit },
    );
  }

  if (status === 409 && /empty/i.test(upstream)) {
    return new GitHubError('empty-repository', 'This repository has no commits yet.', { status, rateLimit });
  }

  if (status === 403 || status === 429) {
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    const retryAfter = Number(response.headers.get('retry-after'));
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const exhausted = remaining === 0 || /rate limit|secondary rate/i.test(upstream);
    if (exhausted) {
      const retryAt = Number.isFinite(reset)
        ? reset
        : Number.isFinite(retryAfter)
          ? Math.floor(Date.now() / 1000) + retryAfter
          : null;
      return new GitHubError(
        'rate-limited',
        rateLimit?.authenticated
          ? 'The server-side GitHub token has hit its rate limit.'
          : 'GitHub’s unauthenticated rate limit (60 requests/hour) is used up. Adding a server-side token raises it to 5000/hour.',
        { status, rateLimit, retryAt },
      );
    }
    return new GitHubError('forbidden', 'GitHub refused this request.', { status, rateLimit });
  }

  if (status >= 500) {
    return new GitHubError('upstream', 'GitHub is having trouble right now. Try again shortly.', { status, rateLimit });
  }

  return new GitHubError('unknown', 'GitHub rejected this request.', { status, rateLimit });
}

export { GITHUB_API_ORIGIN };
