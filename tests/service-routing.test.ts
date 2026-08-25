/**
 * Where each repository reference is served from.
 *
 * The service layer is the place that decides between the built-in demo, the
 * test fixtures and GitHub, so these tests exercise it directly with `fetch`
 * stubbed out — any request that would have gone to api.github.com shows up as
 * a call on the spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_DEMO_SLUG } from '@/lib/builtin/learning-platform';
import { resetBuiltinCache } from '@/lib/builtin/provider';
import { clearFixtureCache } from '@/lib/github/fixtures';
import {
  fetchCommitDetail,
  fetchCommitPage,
  fetchRepoMeta,
  fetchTags,
  fetchTree,
  probeFirstCommitForPath,
} from '@/lib/github/service';
import { isGitHubError } from '@/lib/github/errors';
import { parseRepoRef, type RepoRef } from '@/lib/repo-ref';

const ref = (slug: string): RepoRef => {
  const parsed = parseRepoRef(slug);
  if (!parsed.ok) throw new Error(`bad slug ${slug}: ${parsed.message}`);
  return parsed.value;
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBuiltinCache();
  clearFixtureCache();
  delete process.env.RTM_FIXTURE_MODE;
  // Any GitHub request fails loudly, so nothing can quietly reach the network.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`unexpected network request to ${String(input)}`);
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.RTM_FIXTURE_MODE;
});

describe('the built-in demo, in production configuration', () => {
  it('serves metadata without any network request', async () => {
    const meta = await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));
    expect(meta.dataSource).toBe('builtin');
    expect(meta.slug).toBe(BUILTIN_DEMO_SLUG);
    expect(meta.htmlUrl).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves the whole history without any network request', async () => {
    const demoRef = ref(BUILTIN_DEMO_SLUG);
    const page = await fetchCommitPage(demoRef, 'main', 1);
    expect(page.commits).toHaveLength(16);
    expect(page.totalCommits).toBe(16);
    expect(page.hasOlder).toBe(false);

    for (const commit of page.commits) {
      const detail = await fetchCommitDetail(demoRef, commit.sha);
      const tree = await fetchTree(demoRef, commit.sha);
      expect(detail.sha).toBe(commit.sha);
      expect(tree.commitSha).toBe(commit.sha);
    }

    await fetchTags(demoRef);
    await probeFirstCommitForPath(demoRef, 'main', 'README.md');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a page past the end as empty rather than reaching out', async () => {
    const page = await fetchCommitPage(ref(BUILTIN_DEMO_SLUG), 'main', 2);
    expect(page.commits).toEqual([]);
    expect(page.hasOlder).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a sha that is not part of the demo, without reaching out', async () => {
    await expect(fetchTree(ref(BUILTIN_DEMO_SLUG), '0'.repeat(40))).rejects.toSatisfy(
      (error: unknown) => isGitHubError(error) && error.code === 'not-found',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('works identically when fixture mode is off and on', async () => {
    const first = await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));
    process.env.RTM_FIXTURE_MODE = '1';
    resetBuiltinCache();
    const second = await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));
    expect(second).toEqual(first);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the reserved demo namespace refuses everything else locally', () => {
  const unknown = [
    'demo/learning',
    'demo/learning-platform-extra',
    'demo/Learning-Platform-2',
    'demo/sample-app',
    'demo/big-history',
    'demo/one-commit',
    'demo/x',
    'demo/rate-limited',
  ];

  it.each(unknown)('refuses %s without contacting GitHub', async (slug) => {
    await expect(fetchRepoMeta(ref(slug))).rejects.toSatisfy(
      (error: unknown) => isGitHubError(error) && error.code === 'not-found' && error.isLocal,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an unknown demo reference on every endpoint', async () => {
    const target = ref('demo/not-a-real-demo');
    const sha = 'a'.repeat(40);

    await expect(fetchRepoMeta(target)).rejects.toThrow();
    await expect(fetchCommitPage(target, 'main', 1)).rejects.toThrow();
    await expect(fetchCommitDetail(target, sha)).rejects.toThrow();
    await expect(fetchTree(target, sha)).rejects.toThrow();
    await expect(fetchTags(target)).rejects.toThrow();
    await expect(probeFirstCommitForPath(target, 'main', 'README.md')).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says what the namespace holds, without offering the demo as a substitute', async () => {
    const error = await fetchRepoMeta(ref('demo/not-a-real-demo')).catch((caught: unknown) => caught);
    expect(isGitHubError(error)).toBe(true);
    const message = (error as Error).message;
    expect(message).toContain('demo/not-a-real-demo');
    expect(message).toContain(BUILTIN_DEMO_SLUG);
    expect(message).not.toMatch(/instead|redirect|showing/i);
  });

  it('refuses them in fixture mode too, so fixtures stay unreachable through the namespace', async () => {
    process.env.RTM_FIXTURE_MODE = '1';
    for (const slug of ['demo/sample-app', 'demo/big-history', 'demo/one-commit', 'demo/rate-limited']) {
      await expect(fetchRepoMeta(ref(slug)), slug).rejects.toSatisfy(
        (error: unknown) => isGitHubError(error) && error.code === 'not-found',
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still resolves the one reference that does exist', async () => {
    const meta = await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));
    expect(meta.dataSource).toBe('builtin');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves other owners alone, including ones whose name merely contains "demo"', async () => {
    for (const slug of ['demos/learning-platform', 'my-demo/learning-platform', 'octocat/demo']) {
      await expect(fetchRepoMeta(ref(slug)), slug).rejects.toThrow();
    }
    // Each one was asked of GitHub, which is the correct behaviour for a real owner.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const call of fetchSpy.mock.calls as unknown[][]) {
      expect(String(call[0])).toContain('api.github.com');
    }
  });
});

describe('test fixtures are not reachable in production', () => {
  it.each([
    'rtm-fixtures/sample-app',
    'rtm-fixtures/big-history',
    'rtm-fixtures/one-commit',
    'rtm-fixtures/rate-limited',
  ])('sends %s to GitHub when fixture mode is off', async (slug) => {
    await expect(fetchRepoMeta(ref(slug))).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.github.com');
  });

  it('only serves them once fixture mode is explicitly enabled', async () => {
    process.env.RTM_FIXTURE_MODE = '1';
    const meta = await fetchRepoMeta(ref('rtm-fixtures/sample-app'));
    expect(meta.dataSource).toBe('github');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('live repositories still use the GitHub adapter', () => {
  it('builds an api.github.com URL from the validated owner and repository', async () => {
    await expect(fetchRepoMeta(ref('octocat/hello-world'))).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toBe('https://api.github.com/repos/octocat/hello-world');
  });

  it('never sends the built-in reference to GitHub, even mixed in with live ones', async () => {
    await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));
    await expect(fetchRepoMeta(ref('octocat/hello-world'))).rejects.toThrow();
    await fetchRepoMeta(ref(BUILTIN_DEMO_SLUG));

    const urls = fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('learning-platform');
  });
});
