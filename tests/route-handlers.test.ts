/**
 * The route handlers, exercised directly.
 *
 * These tests care about what a browser actually receives: the status, the error
 * code, and — the point of this suite — whether a response carries a GitHub
 * rate-limit snapshot it has no right to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_DEMO_SLUG } from '@/lib/builtin/learning-platform';
import { resetBuiltinCache } from '@/lib/builtin/provider';
import { clearFixtureCache } from '@/lib/github/fixtures';
import { resetRateLimitStore } from '@/lib/github/rate-limit-store';

import { GET as getRepo } from '@/app/api/gh/repo/route';
import { GET as getCommits } from '@/app/api/gh/commits/route';
import { GET as getCommit } from '@/app/api/gh/commit/route';
import { GET as getTree } from '@/app/api/gh/tree/route';
import { GET as getTags } from '@/app/api/gh/tags/route';
import { GET as getProbe } from '@/app/api/gh/probe/route';

type Handler = (request: Request) => Promise<Response>;

/** Every route, with the extra parameters each one needs. */
const ROUTES: { name: string; handler: Handler; path: string; extra?: string }[] = [
  { name: '/api/gh/repo', handler: getRepo, path: 'repo' },
  { name: '/api/gh/commits', handler: getCommits, path: 'commits', extra: 'branch=main&page=1' },
  { name: '/api/gh/commit', handler: getCommit, path: 'commit', extra: `sha=${'a'.repeat(40)}` },
  { name: '/api/gh/tree', handler: getTree, path: 'tree', extra: `sha=${'a'.repeat(40)}` },
  { name: '/api/gh/tags', handler: getTags, path: 'tags' },
  { name: '/api/gh/probe', handler: getProbe, path: 'probe', extra: 'branch=main&path=README.md' },
];

function url(path: string, slug: string, extra?: string): string {
  const [owner, repo] = slug.split('/');
  const params = new URLSearchParams({ owner: owner ?? '', repo: repo ?? '' });
  const query = extra ? `${params.toString()}&${extra}` : params.toString();
  return `https://rtm.test/api/gh/${path}?${query}`;
}

async function call(route: (typeof ROUTES)[number], slug: string) {
  const response = await route.handler(new Request(url(route.path, slug, route.extra)));
  return { status: response.status, body: await response.json() };
}

/** A GitHub response carrying live rate-limit headers. */
function githubResponse(body: unknown, remaining = 42): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': String(remaining),
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800),
    },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBuiltinCache();
  clearFixtureCache();
  resetRateLimitStore();
  delete process.env.RTM_FIXTURE_MODE;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`unexpected network request to ${String(input)}`);
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  resetRateLimitStore();
  delete process.env.RTM_FIXTURE_MODE;
});

describe('the built-in demo, over the routes', () => {
  it('serves sixteen commits and no repository link', async () => {
    const meta = await call(ROUTES[0]!, BUILTIN_DEMO_SLUG);
    expect(meta.status).toBe(200);
    expect(meta.body.data.meta.dataSource).toBe('builtin');
    expect(meta.body.data.meta.htmlUrl).toBeNull();

    const commits = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    expect(commits.status).toBe(200);
    expect(commits.body.data.commits).toHaveLength(16);
    expect(commits.body.data.totalCommits).toBe(16);
    expect(commits.body.data.hasOlder).toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers every endpoint without a single GitHub request', async () => {
    const list = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    const sha = list.body.data.commits[0].sha;

    for (const route of ROUTES) {
      const extra =
        route.path === 'commit' || route.path === 'tree'
          ? `sha=${sha}`
          : route.extra;
      const response = await route.handler(new Request(url(route.path, BUILTIN_DEMO_SLUG, extra)));
      expect(response.status, route.name).toBe(200);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an unknown reference in the reserved namespace', () => {
  const UNKNOWN = 'demo/not-a-real-demo';

  it.each(ROUTES)('$name returns a local 404', async (route) => {
    const { status, body } = await call(route, UNKNOWN);

    expect(status).toBe(404);
    expect(body.error.code).toBe('not-found');
    expect(body.error.retryAt).toBeNull();
    expect(body.rateLimit).toBeNull();
    expect(body.rateLimitAgeMs).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never invokes the GitHub adapter, across every route at once', async () => {
    for (const route of ROUTES) {
      const { status } = await call(route, UNKNOWN);
      expect(status, route.name).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not offer the built-in demo as a silent substitute', async () => {
    const { body } = await call(ROUTES[0]!, UNKNOWN);
    expect(body.data).toBeUndefined();
    expect(body.error.message).toContain(UNKNOWN);
    expect(body.error.message).toContain(BUILTIN_DEMO_SLUG);
  });

  it('marks the failure uncacheable', async () => {
    const response = await ROUTES[0]!.handler(new Request(url('repo', UNKNOWN)));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([
    'demo/learning',
    'demo/sample-app',
    'demo/big-history',
    'demo/rate-limited',
    'demo/learning-platform-2',
  ])('refuses %s as well', async (slug) => {
    const { status, body } = await call(ROUTES[0]!, slug);
    expect(status).toBe(404);
    expect(body.rateLimit).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cannot reach the test fixtures even with fixture mode on', async () => {
    process.env.RTM_FIXTURE_MODE = '1';
    for (const slug of ['demo/sample-app', 'demo/big-history', 'demo/one-commit']) {
      const { status, body } = await call(ROUTES[0]!, slug);
      expect(status, slug).toBe(404);
      expect(body.data, slug).toBeUndefined();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('rate-limit isolation', () => {
  /**
   * The exact sequence this fix is about: a real GitHub response leaves a quota
   * snapshot in the module-level store, and a locally decided 404 afterwards must
   * not report it as though that request had happened.
   */
  it('does not inherit a snapshot left by an earlier live request', async () => {
    process.env.RTM_FIXTURE_MODE = '';

    // 1. A live GitHub response carrying rate-limit data.
    fetchSpy.mockImplementation(async () =>
      githubResponse({
        name: 'hello-world',
        full_name: 'octocat/hello-world',
        owner: { login: 'octocat' },
        description: null,
        default_branch: 'main',
        html_url: 'https://github.com/octocat/hello-world',
        created_at: '2025-01-01T00:00:00Z',
        pushed_at: '2025-01-02T00:00:00Z',
        language: 'TypeScript',
        stargazers_count: 0,
        forks_count: 0,
        size: 10,
        license: null,
        topics: [],
        archived: false,
        fork: false,
      }),
    );

    const live = await call(ROUTES[0]!, 'octocat/hello-world');
    expect(live.status).toBe(200);
    expect(live.body.rateLimit).toMatchObject({ limit: 60, remaining: 42 });
    expect(live.body.rateLimitAgeMs).toBeGreaterThanOrEqual(0);

    const callsAfterLive = fetchSpy.mock.calls.length;
    expect(callsAfterLive).toBe(1);

    // 2. An unknown reference in the reserved namespace.
    const unknown = await call(ROUTES[0]!, 'demo/not-a-real-demo');

    // 3-5. A local 404 that reports no quota at all.
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not-found');
    expect(unknown.body.rateLimit).toBeNull();
    expect(unknown.body.rateLimitAgeMs).toBeNull();

    // 6. The adapter was not called again.
    expect(fetchSpy.mock.calls.length).toBe(callsAfterLive);
  });

  it('keeps reporting quota on genuine GitHub failures', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-limit': '60',
            'x-ratelimit-remaining': '17',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 900),
          },
        }),
    );

    const { status, body } = await call(ROUTES[0]!, 'octocat/does-not-exist');
    expect(status).toBe(404);
    // A real request happened, so its cost is still worth reporting.
    expect(body.rateLimit).toMatchObject({ limit: 60, remaining: 17 });
    expect(body.rateLimitAgeMs).not.toBeNull();
  });

  it('reports no quota for a malformed request either, since none was spent', async () => {
    fetchSpy.mockImplementation(async () => githubResponse({}, 33));
    // Populate the store from a real response first.
    await call(ROUTES[0]!, 'octocat/hello-world').catch(() => undefined);

    const response = await getRepo(new Request('https://rtm.test/api/gh/repo?owner=..%2F..&repo=x'));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid-input');
    expect(body.rateLimit).toBeNull();
    expect(body.rateLimitAgeMs).toBeNull();
  });
});

describe('live repositories are unaffected', () => {
  it('still builds an api.github.com request from the validated reference', async () => {
    await call(ROUTES[0]!, 'octocat/hello-world');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe(
      'https://api.github.com/repos/octocat/hello-world',
    );
  });

  it('keeps the existing validation behaviour for malformed input', async () => {
    for (const query of ['owner=&repo=x', 'owner=a%2Fb&repo=c', 'owner=settings&repo=x', 'repo=x']) {
      const response = await getRepo(new Request(`https://rtm.test/api/gh/repo?${query}`));
      const body = await response.json();
      expect([400, 404], query).toContain(response.status);
      expect(body.error.code, query).toMatch(/invalid-input|not-found/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never returns a token or an authorization header', async () => {
    process.env.GITHUB_TOKEN = 'ghp_not_a_real_token_for_tests_0000000000';
    try {
      const response = await getRepo(new Request(url('repo', BUILTIN_DEMO_SLUG)));
      const text = await response.text();
      expect(text).not.toContain('ghp_');
      expect(text).not.toContain('GITHUB_TOKEN');
      expect(response.headers.get('authorization')).toBeNull();
      // Only the boolean is exposed.
      expect(JSON.parse(text).data.tokenConfigured).toBe(true);
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
});
