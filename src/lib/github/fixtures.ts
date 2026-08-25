import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RepoRef } from '@/lib/repo-ref';
import { GitHubError } from './errors';
import type { RawCommitDetail, RawCommitListItem, RawRepo, RawTag, RawTree } from './raw-types';

/**
 * Fixture mode replaces the GitHub API with recorded, sanitised payloads on disk.
 *
 * It exists so the Playwright suite can run against a real production build
 * without depending on GitHub's availability or burning rate limit. It is opt-in
 * through an environment variable and is never enabled by default.
 */
export function fixtureModeEnabled(): boolean {
  return process.env.RTM_FIXTURE_MODE === '1';
}

export type FixtureBundle = {
  repo: RawRepo;
  /** Newest-first, matching GitHub's ordering. */
  commits: RawCommitListItem[];
  commitDetail: Record<string, RawCommitDetail>;
  tree: Record<string, RawTree>;
  tags: RawTag[];
};

const FIXTURE_ROOT = path.join(process.cwd(), 'fixtures');

const cache = new Map<string, Promise<FixtureBundle>>();

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function loadFixtures(ref: RepoRef): Promise<FixtureBundle> {
  const key = ref.slug.toLowerCase();
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<FixtureBundle> => {
    const index = await readJson<Record<string, string>>(path.join(FIXTURE_ROOT, 'index.json'));
    const directory = index?.[key];
    if (!directory) {
      throw new GitHubError(
        'not-found',
        'That repository could not be found. This deployment is running in fixture mode and only serves recorded repositories.',
      );
    }
    // Recorded failure states, so the error UI can be exercised end to end.
    if (directory.startsWith('__error:')) {
      const code = directory.slice('__error:'.length);
      throw errorFixture(code);
    }
    // `directory` comes from our own index file, never from user input.
    const base = path.join(FIXTURE_ROOT, directory);
    const bundle = await readJson<FixtureBundle>(path.join(base, 'bundle.json'));
    if (!bundle) throw new GitHubError('upstream', 'Fixture bundle is missing or unreadable.');
    if (bundle.commits.length === 0) {
      // Recorded empty repository: metadata exists, history does not.
      return { ...bundle, commitDetail: {}, tree: {}, tags: [] };
    }
    return bundle;
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

function errorFixture(code: string): GitHubError {
  switch (code) {
    case 'rate-limited':
      return new GitHubError(
        'rate-limited',
        'GitHub\u2019s unauthenticated rate limit (60 requests/hour) is used up. Adding a server-side token raises it to 5000/hour.',
        {
          rateLimit: { limit: 60, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 1800, authenticated: false },
          retryAt: Math.floor(Date.now() / 1000) + 1800,
        },
      );
    case 'private':
      return new GitHubError(
        'not-found',
        'That repository could not be found. It may be private, renamed, or misspelled \u2014 Repo Time Machine only reads public repositories.',
      );
    case 'timeout':
      return new GitHubError('timeout', 'GitHub did not respond in time. Try again in a moment.');
    default:
      return new GitHubError('upstream', 'GitHub is having trouble right now. Try again shortly.');
  }
}

/** Test seam. */
export function clearFixtureCache(): void {
  cache.clear();
}
