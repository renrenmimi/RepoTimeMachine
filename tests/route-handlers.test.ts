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
import { GET as getCompare } from '@/app/api/gh/compare/route';

type Handler = (request: Request) => Promise<Response>;

/** Every route, with the extra parameters each one needs. */
const ROUTES: { name: string; handler: Handler; path: string; extra?: string }[] = [
  { name: '/api/gh/repo', handler: getRepo, path: 'repo' },
  { name: '/api/gh/commits', handler: getCommits, path: 'commits', extra: 'branch=main&page=1' },
  { name: '/api/gh/commit', handler: getCommit, path: 'commit', extra: `sha=${'a'.repeat(40)}` },
  { name: '/api/gh/tree', handler: getTree, path: 'tree', extra: `sha=${'a'.repeat(40)}` },
  { name: '/api/gh/tags', handler: getTags, path: 'tags' },
  { name: '/api/gh/probe', handler: getProbe, path: 'probe', extra: 'branch=main&path=README.md' },
  {
    name: '/api/gh/compare',
    handler: getCompare,
    path: 'compare',
    extra: `base=${'a'.repeat(40)}&head=${'b'.repeat(40)}`,
  },
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
    const commits = list.body.data.commits as { sha: string }[];
    const sha = commits[0]!.sha;

    for (const route of ROUTES) {
      // Routes addressed by sha need real ones from this history.
      const extra =
        route.path === 'commit' || route.path === 'tree'
          ? `sha=${sha}`
          : route.path === 'compare'
            ? `base=${commits[commits.length - 1]!.sha}&head=${sha}`
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

describe('the compare route', () => {
  const path = 'compare';

  async function compareUrl(base: string, head: string, slug = BUILTIN_DEMO_SLUG) {
    const response = await getCompare(new Request(url(path, slug, `base=${base}&head=${head}`)));
    return { status: response.status, body: await response.json() };
  }

  it('compares two points of the built-in demo with no GitHub request', async () => {
    const list = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    const commits = list.body.data.commits as { sha: string }[];
    // The list is newest-first, so these are 10 apart in the history.
    const head = commits[0]!.sha;
    const base = commits[10]!.sha;

    const { status, body } = await compareUrl(base, head);
    expect(status).toBe(200);
    expect(body.data.compare.status).toBe('ahead');
    expect(body.data.compare.aheadBy).toBe(10);
    expect(body.data.compare.commits).toHaveLength(10);
    expect(body.data.compare.files.length).toBeGreaterThan(0);
    expect(body.data.compare.htmlUrl).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts abbreviated shas, as a shared link carries', async () => {
    const list = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    const commits = list.body.data.commits as { sha: string }[];

    const { status, body } = await compareUrl(commits[5]!.sha.slice(0, 10), commits[0]!.sha.slice(0, 10));
    expect(status).toBe(200);
    expect(body.data.compare.aheadBy).toBe(5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports two identical points as identical, with nothing changed', async () => {
    const list = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    const sha = (list.body.data.commits as { sha: string }[])[3]!.sha;

    const { status, body } = await compareUrl(sha, sha);
    expect(status).toBe(200);
    expect(body.data.compare.status).toBe('identical');
    expect(body.data.compare.files).toEqual([]);
  });

  it.each([
    ['a missing base', `head=${'a'.repeat(40)}`],
    ['a missing head', `base=${'a'.repeat(40)}`],
    ['a malformed base', `base=nope&head=${'a'.repeat(40)}`],
    ['a traversal attempt', `base=..%2F..&head=${'a'.repeat(40)}`],
    ['a branch name instead of a sha', `base=main&head=${'a'.repeat(40)}`],
  ])('rejects %s before any request', async (_name, query) => {
    const response = await getCompare(new Request(url(path, BUILTIN_DEMO_SLUG, query)));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid-input');
    expect(body.rateLimit).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a sha that is not part of the demo, locally', async () => {
    const { status, body } = await compareUrl('a'.repeat(40), 'b'.repeat(40));
    expect(status).toBe(404);
    expect(body.error.code).toBe('not-found');
    expect(body.rateLimit).toBeNull();
    expect(body.rateLimitAgeMs).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an unknown demo reference locally', async () => {
    const { status, body } = await compareUrl('a'.repeat(40), 'b'.repeat(40), 'demo/not-a-real-demo');
    expect(status).toBe(404);
    expect(body.rateLimit).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds a compare request for a live repository', async () => {
    const base = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    fetchSpy.mockImplementation(async () =>
      githubResponse({
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        base_commit: { sha: base, html_url: '', commit: { message: 'base', author: null, committer: null }, author: null, parents: [] },
        commits: [
          { sha: head, html_url: '', commit: { message: 'head', author: null, committer: null }, author: null, parents: [] },
        ],
        files: [],
      }),
    );

    const response = await getCompare(
      new Request(url(path, 'octocat/hello-world', `base=${base}&head=${head}`)),
    );
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe(
      `https://api.github.com/repos/octocat/hello-world/compare/${base}...${head}`,
    );
  });

  it('drops a label that is not a plausible tag name', async () => {
    const list = await call(ROUTES[1]!, BUILTIN_DEMO_SLUG);
    const commits = list.body.data.commits as { sha: string }[];
    const response = await getCompare(
      new Request(
        url(
          path,
          BUILTIN_DEMO_SLUG,
          `base=${commits[2]!.sha}&head=${commits[0]!.sha}&headLabel=${encodeURIComponent('<script>x</script>')}`,
        ),
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    // The label was refused, so the endpoint stays a plain commit.
    expect(body.data.compare.head.tagName).toBeNull();
    expect(body.data.compare.head.kind).toBe('commit');
  });
});
