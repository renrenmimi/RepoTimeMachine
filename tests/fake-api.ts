import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, type GitHubApi, type FetchOptions } from '@/lib/client/api';
import type { RateLimitSnapshot } from '@/lib/domain/types';
import { compareLocalHistory } from '@/lib/compare/local';
import { toCommit, toCommitDetail, toRepoMeta, toRepoTree, toTags } from '@/lib/github/adapter';
import { fixtureCommitDetail, fixtureTree, type FixtureBundle } from '@/lib/github/fixture-bundle';
import type { RepoRef } from '@/lib/repo-ref';

export type Bundle = FixtureBundle;

const cache = new Map<string, Bundle>();

/** Loads one of the recorded fixture bundles from disk. */
export function loadBundle(name: string): Bundle {
  const existing = cache.get(name);
  if (existing) return existing;
  const file = path.join(process.cwd(), 'fixtures', name, 'bundle.json');
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as Bundle;
  cache.set(name, bundle);
  return bundle;
}

export type FakeApiOptions = {
  /** Fixture directory name per `owner/repo`, lower-cased. */
  bundles: Record<string, string>;
  /** Artificial latency in milliseconds, per endpoint kind. */
  latency?: number;
  /** Requests to fail, by endpoint kind. */
  fail?: Partial<Record<Endpoint, ApiError>>;
  rateLimit?: RateLimitSnapshot;
  /** What the /repo route reports about a server-side token. */
  tokenConfigured?: boolean;
};

export type Endpoint = 'repo' | 'commits' | 'commit' | 'tree' | 'tags' | 'probe' | 'compare';

const PER_PAGE = 100;

export function rateLimited(): ApiError {
  return new ApiError(
    {
      code: 'rate-limited',
      message: 'GitHub rate limit reached.',
      retryAt: Math.floor(Date.now() / 1000) + 600,
    },
    { limit: 60, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 600, authenticated: false },
  );
}

export function notFound(): ApiError {
  return new ApiError({ code: 'not-found', message: 'That repository could not be found.', retryAt: null }, null);
}

/**
 * An in-process stand-in for the route handlers.
 *
 * It records every call so tests can assert on request counts, and honours the
 * AbortSignal so stale-request behaviour can be verified without a network.
 */
export class FakeApi implements GitHubApi {
  readonly calls: { endpoint: Endpoint; slug: string; arg?: string }[] = [];
  #options: FakeApiOptions;
  /** Resolves pending requests manually when latency is set to `Infinity`. */
  #gates: (() => void)[] = [];

  constructor(options: FakeApiOptions) {
    this.#options = options;
  }

  get callCount(): number {
    return this.calls.length;
  }

  countOf(endpoint: Endpoint): number {
    return this.calls.filter((call) => call.endpoint === endpoint).length;
  }

  releaseAll(): void {
    const gates = this.#gates;
    this.#gates = [];
    for (const gate of gates) gate();
  }

  setRateLimit(rateLimit: RateLimitSnapshot): void {
    this.#options = { ...this.#options, rateLimit };
  }

  #bundle(ref: RepoRef): Bundle {
    const name = this.#options.bundles[ref.slug.toLowerCase()];
    if (!name) throw notFound();
    return loadBundle(name);
  }

  async #enter(endpoint: Endpoint, ref: RepoRef, arg: string | undefined, options: FetchOptions): Promise<void> {
    this.calls.push({ endpoint, slug: ref.slug, ...(arg ? { arg } : {}) });
    const failure = this.#options.fail?.[endpoint];
    const latency = this.#options.latency ?? 0;

    if (latency === Infinity) {
      await new Promise<void>((resolve, reject) => {
        this.#gates.push(resolve);
        options.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    } else if (latency > 0) {
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, latency);
        options.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(id);
            reject(abortError());
          },
          { once: true },
        );
      });
    }

    if (options.signal?.aborted) throw abortError();
    options.onRateLimit?.(this.#options.rateLimit ?? defaultRateLimit(), 0);
    if (failure) throw failure;
  }

  fetchRepo = async (ref: RepoRef, options: FetchOptions = {}) => {
    await this.#enter('repo', ref, undefined, options);
    const bundle = this.#bundle(ref);
    return {
      meta: toRepoMeta(bundle.repo, bundle.commits.length === 0),
      tokenConfigured: this.#options.tokenConfigured ?? true,
    };
  };

  fetchCommits = async (ref: RepoRef, branch: string, page: number, options: FetchOptions = {}) => {
    await this.#enter('commits', ref, `page=${page}`, options);
    const bundle = this.#bundle(ref);
    const start = (page - 1) * PER_PAGE;
    const slice = bundle.commits.slice(start, start + PER_PAGE);
    return {
      commits: slice.map((raw, i) => toCommit(raw, start + i)),
      page,
      perPage: PER_PAGE,
      hasOlder: start + slice.length < bundle.commits.length,
      totalCommits: bundle.commits.length,
      branch,
    };
  };

  fetchCommitDetail = async (ref: RepoRef, sha: string, options: FetchOptions = {}) => {
    await this.#enter('commit', ref, sha, options);
    const bundle = this.#bundle(ref);
    const raw = fixtureCommitDetail(bundle, sha);
    if (!raw) throw notFound();
    return { detail: toCommitDetail(raw) };
  };

  fetchTree = async (ref: RepoRef, sha: string, options: FetchOptions = {}) => {
    await this.#enter('tree', ref, sha, options);
    const bundle = this.#bundle(ref);
    const raw = fixtureTree(bundle, sha);
    if (!raw) throw notFound();
    return { tree: toRepoTree(raw, sha) };
  };

  fetchTags = async (ref: RepoRef, options: FetchOptions = {}) => {
    await this.#enter('tags', ref, undefined, options);
    return { tags: toTags(this.#bundle(ref).tags) };
  };

  fetchCompare = async (
    ref: RepoRef,
    base: string,
    head: string,
    labels: { base: string | null; head: string | null } = { base: null, head: null },
    options: FetchOptions = {},
  ) => {
    await this.#enter('compare', ref, `${base}...${head}`, options);
    const bundle = this.#bundle(ref);
    const commits = [...bundle.commits].reverse().map((raw, index) => toCommit(raw, index));
    const compare = compareLocalHistory(
      {
        commits,
        snapshotAt: (sha) => {
          const raw = fixtureTree(bundle, sha);
          if (!raw) return null;
          const out = new Map<string, string>();
          for (const entry of raw.tree) {
            if (entry.type === 'blob') out.set(entry.path, entry.sha);
          }
          return out;
        },
        detailOf: (sha) => {
          const raw = fixtureCommitDetail(bundle, sha);
          return raw ? toCommitDetail(raw) : null;
        },
        tagOf: (sha) => bundle.tags.find((tag) => tag.commit.sha === sha)?.name ?? null,
      },
      base,
      head,
    );
    if (!compare) throw notFound();
    // Labels are display-only, exactly as the route echoes them.
    if (labels.base) compare.base = { ...compare.base, kind: 'tag', tagName: labels.base };
    if (labels.head) compare.head = { ...compare.head, kind: 'tag', tagName: labels.head };
    return { compare };
  };

  fetchProbe = async (ref: RepoRef, branch: string, filePath: string, options: FetchOptions = {}) => {
    await this.#enter('probe', ref, filePath, options);
    const bundle = this.#bundle(ref);
    const touching = bundle.commits.filter((commit) =>
      bundle.commitDetail[commit.sha]?.files.some((file) => file.filename === filePath),
    );
    const oldest = touching[touching.length - 1];
    return { path: filePath, firstSha: oldest?.sha ?? null, incomplete: false };
  };
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function defaultRateLimit(): RateLimitSnapshot {
  return { limit: 5000, remaining: 4900, resetAt: Math.floor(Date.now() / 1000) + 3600, authenticated: true };
}

/**
 * Waits for the background diff loader to have started and finished.
 *
 * `densify.target` is set once and never cleared, which makes it a reliable
 * marker even when the whole pass completes inside a single microtask turn.
 */
export async function settle(
  controller: { getState: () => { densify: { active: boolean; target: number }; commits: unknown[] } },
  timeout = 5000,
): Promise<void> {
  if (controller.getState().commits.length === 0) return;
  await until(() => controller.getState().densify.target > 0, timeout);
  await until(() => !controller.getState().densify.active, timeout);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Waits until `predicate` holds, or fails the test after `timeout`. */
export async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function ref(slug: string): RepoRef {
  const [owner, repo] = slug.split('/');
  return { owner: owner!, repo: repo!, slug };
}
