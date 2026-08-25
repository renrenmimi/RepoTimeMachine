import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_DEMO_SLUG,
  DEMO_COMMITS,
  DEMO_TAGS,
} from '@/lib/builtin/learning-platform';
import {
  BUILTIN_DEMO_REF,
  builtinCommitDetail,
  builtinCommitPage,
  builtinFirstCommitForPath,
  builtinRepoMeta,
  builtinTags,
  builtinTree,
  isBuiltinRef,
  isBuiltinSlug,
  resetBuiltinCache,
} from '@/lib/builtin/provider';
import { BUILTIN_DEMO } from '@/lib/demos';
import { detectMilestones } from '@/lib/milestones/detect';
import { parseRepoRef } from '@/lib/repo-ref';
import { buildActivityMap, buildGrowthSeries, estimateLanguages } from '@/lib/stats/growth';
import { TreeProjector } from '@/lib/tree/projector';
import { fileSetFromTree } from '@/lib/tree/build';
import { parseAppUrl, buildAppUrl } from '@/lib/url/state';

/** The demo, oldest first, in the domain shape the UI consumes. */
function loadDemo() {
  const page = builtinCommitPage(1, 100);
  const commits = [...page.commits].reverse().map((commit, index) => ({ ...commit, index }));
  return { commits, totalCommits: page.totalCommits, hasOlder: page.hasOlder };
}

beforeEach(() => {
  resetBuiltinCache();
});

describe('the demo is exactly sixteen commits', () => {
  it('declares sixteen in the fixture', () => {
    expect(DEMO_COMMITS).toHaveLength(16);
    expect(BUILTIN_DEMO.commitCount).toBe(16);
  });

  it('serves sixteen, with no older page', () => {
    const { commits, totalCommits, hasOlder } = loadDemo();
    expect(commits).toHaveLength(16);
    expect(totalCommits).toBe(16);
    expect(hasOlder).toBe(false);
  });

  it('uses the prescribed subjects, in order', () => {
    expect(loadDemo().commits.map((commit) => commit.subject)).toEqual([
      'chore: scaffold the application shell',
      'feat: establish design tokens and layout primitives',
      'feat: define lesson and exercise models',
      'feat: add progress state and local persistence',
      'feat: publish the first guided lesson',
      'feat: expand the learning library',
      'feat: generate navigation and search indexes',
      'feat: add guided practice sessions',
      'feat: introduce the coding workspace',
      'feat: add assessment and review modes',
      'feat: introduce guided learning paths',
      'feat: make progress and continuation plan-aware',
      'refactor: unify navigation and next actions',
      'feat: add dashboard progress views',
      'fix: align responsive layouts and accessibility',
      'fix: lock background scrolling behind the mobile drawer',
    ]);
  });
});

describe('object ids and timestamps', () => {
  it('has sixteen unique, valid 40-character hexadecimal shas', () => {
    const shas = DEMO_COMMITS.map((commit) => commit.sha);
    expect(new Set(shas).size).toBe(16);
    for (const sha of shas) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('is deterministic across rebuilds', () => {
    const first = loadDemo().commits.map((commit) => commit.sha);
    resetBuiltinCache();
    const second = loadDemo().commits.map((commit) => commit.sha);
    expect(second).toEqual(first);
  });

  it('is strictly chronological', () => {
    const times = loadDemo().commits.map((commit) => Date.parse(commit.author.date));
    expect(times.every((value) => Number.isFinite(value))).toBe(true);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
  });

  it('links each commit to its parent, starting from a parentless first commit', () => {
    const { commits } = loadDemo();
    expect(commits[0]!.parents).toEqual([]);
    for (let i = 1; i < commits.length; i += 1) {
      expect(commits[i]!.parents).toEqual([commits[i - 1]!.sha]);
    }
  });

  it('uses a generic author and never links to a repository', () => {
    for (const commit of loadDemo().commits) {
      expect(commit.author.name).toBe('Demo Maintainer');
      expect(commit.author.login).toBeNull();
      expect(commit.author.avatarUrl).toBeNull();
      expect(commit.htmlUrl).toBeNull();
    }
    expect(builtinRepoMeta().htmlUrl).toBeNull();
  });
});

describe('commit detail and trees', () => {
  it('has a detail record for every commit', () => {
    for (const commit of loadDemo().commits) {
      const detail = builtinCommitDetail(commit.sha);
      expect(detail, commit.subject).not.toBeNull();
      expect(detail!.files.length).toBeGreaterThan(0);
      expect(detail!.changedFiles).toBe(detail!.files.length);
    }
  });

  it('records meaningful additions and deletions', () => {
    const details = loadDemo().commits.map((commit) => builtinCommitDetail(commit.sha)!);
    expect(details.every((detail) => detail.additions > 0)).toBe(true);
    // Not a history that only ever adds: some commits remove lines too.
    expect(details.filter((detail) => detail.deletions > 0).length).toBeGreaterThan(4);
  });

  it('has an exact tree for every commit', () => {
    for (const commit of loadDemo().commits) {
      const tree = builtinTree(commit.sha);
      expect(tree, commit.subject).not.toBeNull();
      expect(tree!.commitSha).toBe(commit.sha);
      expect(tree!.truncated).toBe(false);
      expect(tree!.entries.some((entry) => entry.type === 'blob')).toBe(true);
    }
  });

  it('grows visibly from the first tree to the last', () => {
    const { commits } = loadDemo();
    const first = fileSetFromTree(builtinTree(commits[0]!.sha)!);
    const last = fileSetFromTree(builtinTree(commits[15]!.sha)!);

    expect(first.size).toBeGreaterThan(0);
    expect(last.size).toBeGreaterThan(first.size * 5);
    // And it is a different set, not simply a longer one.
    expect([...last.keys()].some((path) => !first.has(path))).toBe(true);
  });

  it('removes files as well as adding them', () => {
    const { commits } = loadDemo();
    const before = fileSetFromTree(builtinTree(commits[11]!.sha)!);
    const after = fileSetFromTree(builtinTree(commits[12]!.sha)!);
    const removed = [...before.keys()].filter((path) => !after.has(path));
    expect(removed.length).toBeGreaterThan(0);
  });

  it('reports blob sizes, so byte statistics are complete', () => {
    const tree = builtinTree(loadDemo().commits[15]!.sha)!;
    const blobs = tree.entries.filter((entry) => entry.type === 'blob');
    expect(blobs.every((entry) => typeof entry.size === 'number' && entry.size > 0)).toBe(true);
  });

  it('returns nothing for a sha that is not part of the demo', () => {
    expect(builtinCommitDetail('0'.repeat(40))).toBeNull();
    expect(builtinTree('0'.repeat(40))).toBeNull();
  });
});

describe('derived views use the normal application logic', () => {
  function projector() {
    const { commits } = loadDemo();
    const instance = new TreeProjector();
    instance.setCommits(commits);
    for (const commit of commits) {
      instance.addSnapshot(commit.sha, builtinTree(commit.sha)!);
      instance.addDetail(commit.sha, builtinCommitDetail(commit.sha)!);
    }
    return { instance, commits };
  }

  it('renders every timeline position exactly', () => {
    const { instance, commits } = projector();
    for (let index = 0; index < commits.length; index += 1) {
      const projection = instance.project(index);
      expect(projection.fidelity, `commit ${index + 1}`).toBe('exact');
      expect(projection.missingCommits).toBe(0);
      expect(projection.files.size).toBeGreaterThan(0);
    }
  });

  it('derives a complete growth series through buildGrowthSeries', () => {
    const { instance, commits } = projector();
    const series = buildGrowthSeries(commits, instance);

    expect(series.points).toHaveLength(16);
    expect(series.knownCommits).toBe(16);
    expect(series.coverage).toBe(1);
    expect(series.points.every((point) => point.measured)).toBe(true);
    expect(series.totalAdditions).toBeGreaterThan(0);
    expect(series.totalDeletions).toBeGreaterThan(0);
    // A growing project: the file count never falls below where it started.
    expect(series.points.at(-1)!.fileCount).toBeGreaterThan(series.points[0]!.fileCount);
    expect(series.maxFiles).toBe(series.points.at(-1)!.fileCount);
  });

  it('derives a language estimate through estimateLanguages', () => {
    const { instance, commits } = projector();
    const estimate = estimateLanguages(instance.project(commits.length - 1).files);
    expect(estimate.countedFiles).toBeGreaterThan(10);
    expect(estimate.slices.map((slice) => slice.language)).toContain('TypeScript');
    expect(estimate.slices.every((slice) => slice.share > 0)).toBe(true);
  });

  it('derives an activity map through buildActivityMap', () => {
    const { commits } = loadDemo();
    const details = new Map(commits.map((commit) => [commit.sha, builtinCommitDetail(commit.sha)!]));
    const map = buildActivityMap(commits, details);
    expect(map.knownCommits).toBe(16);
    expect(map.areas.length).toBeGreaterThan(2);
    expect(map.max).toBeGreaterThan(0);
  });

  it('detects milestones that explain the progression', () => {
    const { commits } = loadDemo();
    const changesBySha = new Map(
      commits.map((commit) => [commit.sha, builtinCommitDetail(commit.sha)!.files]),
    );
    const milestones = detectMilestones({
      commits,
      tags: builtinTags(),
      changesBySha,
      snapshots: commits.map((commit) => ({
        commitIndex: commit.index,
        paths: new Set(fileSetFromTree(builtinTree(commit.sha)!).keys()),
      })),
    });

    const kinds = new Set(milestones.map((milestone) => milestone.kind));
    for (const expected of [
      'initial-commit',
      'first-readme',
      'first-manifest',
      'first-lockfile',
      'first-typescript',
      'framework-config',
      'first-test',
      'first-ci',
      'first-deploy-config',
      'first-license',
      'release-tag',
      'structural-change',
      'large-change',
      'new-language',
    ]) {
      expect(kinds, `expected a ${expected} milestone`).toContain(expected);
    }

    // Every path milestone is pinned to a single commit, because all diffs exist.
    expect(milestones.every((milestone) => milestone.confidence === 'exact')).toBe(true);
    expect(milestones.every((milestone) => milestone.commitIndex >= 0 && milestone.commitIndex < 16)).toBe(true);
  });

  it('places its release tags inside the range', () => {
    const { commits } = loadDemo();
    expect(DEMO_TAGS).toHaveLength(2);
    for (const tag of builtinTags()) {
      expect(commits.some((commit) => commit.sha === tag.sha)).toBe(true);
    }
  });
});

describe('scope of the built-in provider', () => {
  it('recognises only the exact reference', () => {
    expect(isBuiltinSlug(BUILTIN_DEMO_SLUG)).toBe(true);
    expect(isBuiltinSlug('DEMO/Learning-Platform')).toBe(true);
    expect(isBuiltinRef(BUILTIN_DEMO_REF)).toBe(true);
  });

  it.each([
    'demo/learning',
    'demo/learning-platform-2',
    'demo/big-history',
    'demo/one-commit',
    'demo/sample-app',
    'rtm-fixtures/sample-app',
    'demo/x',
    'octocat/learning-platform',
  ])('does not claim %s', (slug) => {
    expect(isBuiltinSlug(slug)).toBe(false);
    expect(isBuiltinRef({ slug })).toBe(false);
  });

  it('parses as an ordinary reference, so no parser exception is needed', () => {
    const parsed = parseRepoRef(BUILTIN_DEMO_SLUG);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.slug).toBe(BUILTIN_DEMO_SLUG);
  });

  it('declares itself built-in and carries no GitHub identity', () => {
    const meta = builtinRepoMeta();
    expect(meta.dataSource).toBe('builtin');
    expect(meta.htmlUrl).toBeNull();
    expect(meta.slug).toBe(BUILTIN_DEMO_SLUG);
    expect(meta.isEmpty).toBe(false);
  });

  it('answers path probes from the fixture', () => {
    expect(builtinFirstCommitForPath('README.md')).toBe(DEMO_COMMITS[0]!.sha);
    expect(builtinFirstCommitForPath('.github/workflows/ci.yml')).toBe(DEMO_COMMITS[9]!.sha);
    expect(builtinFirstCommitForPath('nothing/here.ts')).toBeNull();
  });
});

describe('the demo makes no network request', () => {
  it('never calls fetch while building or serving the whole history', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    resetBuiltinCache();

    const { commits } = loadDemo();
    builtinRepoMeta();
    builtinTags();
    for (const commit of commits) {
      builtinCommitDetail(commit.sha);
      builtinTree(commit.sha);
      builtinFirstCommitForPath('README.md');
    }

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('privacy of the fixture content', () => {
  const text = JSON.stringify({
    commits: DEMO_COMMITS,
    tags: DEMO_TAGS,
    meta: builtinRepoMeta(),
  });

  it('names no repository owner and links nowhere', () => {
    // A curated history has no upstream, so it must not smell like one.
    expect(text).not.toContain('github.com');
    expect(text).not.toContain('https://');
    expect(text).not.toMatch(/\bgit@/);
  });

  it('contains no e-mail address', () => {
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it('contains no issue or pull-request references', () => {
    expect(text).not.toMatch(/\(#\d+\)/);
    expect(text.toLowerCase()).not.toContain('pull request');
    expect(text.toLowerCase()).not.toContain('merge pull');
  });

  it('uses only the generic maintainer identity', () => {
    const authors = new Set(loadDemo().commits.map((commit) => commit.author.name));
    expect([...authors]).toEqual(['Demo Maintainer']);
  });

  it('uses paths that read as a generic learning product', () => {
    const paths = new Set(DEMO_COMMITS.flatMap((commit) => commit.changes.map((change) => change.path)));
    expect(paths.size).toBeGreaterThan(50);
    for (const path of paths) {
      // Repository-relative, no absolute paths and no escapes.
      expect(path.startsWith('/')).toBe(false);
      expect(path).not.toContain('..');
      expect(path).toMatch(/^[A-Za-z0-9._[\]/-]+$/);
    }
  });
});

describe('sharing a built-in demo URL', () => {
  it('round-trips the demo reference and a selected commit', () => {
    const commit = loadDemo().commits[7]!;
    const url = buildAppUrl({ repo: BUILTIN_DEMO_REF, commit: commit.sha });
    expect(url).toContain('repo=demo%2Flearning-platform');

    const restored = parseAppUrl(url.replace('/?', '?'));
    expect(restored.repo?.slug).toBe(BUILTIN_DEMO_SLUG);
    expect(commit.sha.startsWith(restored.commit!)).toBe(true);
  });
});
