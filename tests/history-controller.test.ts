import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_PAGES, HistoryController, MAX_PAGES, planCheckpoints } from '@/lib/client/history-controller';
import { FakeApi, notFound, rateLimited, ref, settle, until } from './fake-api';

const BUNDLES = {
  'renrenmimi/renren-across-tabs': 'renren-across-tabs',
  'renrenmimi/drilllab': 'drilllab',
  'rtm-fixtures/one-commit': 'one-commit',
  'rtm-fixtures/empty-repo': 'empty-repo',
  'rtm-fixtures/big-history': 'big-history',
};

const TINY = ref('renrenmimi/renren-across-tabs');
const MEDIUM = ref('renrenmimi/DrillLab');
const ONE = ref('rtm-fixtures/one-commit');
const EMPTY = ref('rtm-fixtures/empty-repo');
const BIG = ref('rtm-fixtures/big-history');

const controllers: HistoryController[] = [];

function make(api: FakeApi): HistoryController {
  // Derived data is recomputed synchronously in tests, so assertions do not race a timer.
  const controller = new HistoryController({
    api,
    scheduleRecompute: (run) => {
      run();
      return () => {};
    },
  });
  controllers.push(controller);
  return controller;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe('loading a repository', () => {
  it('loads metadata, the full history of a small repository and its trees', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(TINY);

    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.meta?.slug).toBe('renrenmimi/renren-across-tabs');
    expect(state.commits).toHaveLength(5);
    expect(state.totalCommits).toBe(5);
    expect(state.hasOlder).toBe(false);
  });

  it('orders commits oldest first and indexes them from zero', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(TINY);
    const { commits } = controller.getState();

    expect(commits[0]?.index).toBe(0);
    expect(commits.at(-1)?.index).toBe(commits.length - 1);
    expect(commits[0]?.parents).toHaveLength(0);

    const dates = commits.map((commit) => Date.parse(commit.author.date));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('links each commit to its parent in order', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(TINY);
    const { commits } = controller.getState();
    for (let i = 1; i < commits.length; i += 1) {
      expect(commits[i]?.parents).toContain(commits[i - 1]?.sha);
    }
  });

  it('starts on the newest commit, paused', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(TINY);
    const state = controller.getState();
    expect(state.playback.index).toBe(state.commits.length - 1);
    expect(state.playback.playing).toBe(false);
  });

  it('handles a repository with exactly one commit', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(ONE);
    await settle(controller);
    const state = controller.getState();
    expect(state.commits).toHaveLength(1);
    expect(state.playback).toMatchObject({ index: 0, count: 1, playing: false });
    expect(state.milestones.map((m) => m.kind)).toContain('initial-commit');
  });

  it('reports an empty repository without pretending to have history', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(EMPTY);
    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.meta?.isEmpty).toBe(true);
    expect(state.commits).toEqual([]);
    expect(state.totalCommits).toBe(0);
  });

  it('does not ask for commits at all when the repository is empty', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(EMPTY);
    expect(api.countOf('commits')).toBe(0);
    expect(api.countOf('tree')).toBe(0);
  });

  it('surfaces a not-found failure and stops', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(ref('nobody/nothing'));
    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('not-found');
    expect(state.commits).toEqual([]);
  });

  it('surfaces a rate-limit failure with the retry time', async () => {
    const api = new FakeApi({ bundles: BUNDLES, fail: { repo: rateLimited() } });
    const controller = make(api);
    await controller.load(TINY);
    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.error?.code).toBe('rate-limited');
    expect(state.error?.retryAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('records the rate-limit snapshot the server reported', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(TINY);
    expect(controller.getState().rateLimit).toMatchObject({ limit: 5000, authenticated: true });
  });
});

describe('pagination boundaries', () => {
  it('stops after one page when the repository has fewer than a page of commits', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(MEDIUM);
    expect(controller.getState().commits).toHaveLength(64);
    expect(api.countOf('commits')).toBe(1);
    expect(controller.getState().hasOlder).toBe(false);
  });

  it('loads at most the automatic page budget for a long history', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);

    const state = controller.getState();
    expect(state.commits).toHaveLength(AUTO_PAGES * 100);
    expect(state.totalCommits).toBe(640);
    expect(state.hasOlder).toBe(true);
    expect(state.pagesLoaded).toBe(AUTO_PAGES);
  });

  it('loads the newest commits first, so the range ends at HEAD', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);
    const { commits } = controller.getState();
    // The oldest loaded commit is not the repository's first commit.
    expect(commits[0]?.parents.length).toBeGreaterThan(0);
  });

  it('extends the range backwards on request and keeps the selected commit', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);

    const before = controller.getState();
    const selected = before.commits[before.playback.index]!.sha;

    await controller.loadOlder();

    const after = controller.getState();
    expect(after.commits).toHaveLength(400);
    expect(after.pagesLoaded).toBe(4);
    expect(after.commits[after.playback.index]?.sha).toBe(selected);
    // Every index shifted, so the playhead had to move with it.
    expect(after.playback.index).toBe(before.playback.index + 100);
    expect(after.playback.count).toBe(400);
  });

  it('keeps the range contiguous and ordered after loading older commits', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(BIG);
    await controller.loadOlder();

    const { commits } = controller.getState();
    expect(new Set(commits.map((c) => c.sha)).size).toBe(commits.length);
    expect(commits.map((c) => c.index)).toEqual(commits.map((_, i) => i));
    const dates = commits.map((c) => Date.parse(c.author.date));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('refuses to page past the hard limit', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);
    for (let i = 0; i < MAX_PAGES + 3; i += 1) await controller.loadOlder();
    expect(controller.getState().pagesLoaded).toBeLessThanOrEqual(MAX_PAGES);
    expect(controller.getState().hasOlder).toBe(false);
  });

  it('ignores loadOlder when there is nothing older', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(TINY);
    const before = api.countOf('commits');
    await controller.loadOlder();
    expect(api.countOf('commits')).toBe(before);
  });
});

describe('request budgeting', () => {
  it('never issues one request per commit during the initial load', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);
    // Metadata + three commit pages + tags + a bounded number of trees.
    const upFront = api.calls.filter((call) => call.endpoint !== 'commit' && call.endpoint !== 'probe');
    expect(upFront.length).toBeLessThan(20);
    expect(controller.getState().commits.length).toBe(300);
  });

  it('fetches a bounded number of tree snapshots', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(BIG);
    await settle(controller);
    expect(api.countOf('tree')).toBeLessThanOrEqual(10);
  });

  it('de-duplicates repeated requests for the same commit diff', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(ONE);
    const sha = controller.getState().commits[0]!.sha;

    await Promise.all([controller.ensureDetail(sha), controller.ensureDetail(sha), controller.ensureDetail(sha)]);
    await controller.ensureDetail(sha);

    expect(api.calls.filter((call) => call.endpoint === 'commit' && call.arg === sha)).toHaveLength(1);
  });

  it('stops background work when the remaining quota gets low', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    api.setRateLimit({ limit: 60, remaining: 4, resetAt: Math.floor(Date.now() / 1000) + 600, authenticated: false });
    const controller = make(api);
    await controller.load(MEDIUM);
    await settle(controller);
    expect(api.countOf('commit')).toBeLessThan(10);
  });

  it('explains why fewer diffs were loaded when running without a token', async () => {
    const api = new FakeApi({ bundles: BUNDLES, tokenConfigured: false });
    api.setRateLimit({ limit: 60, remaining: 55, resetAt: Math.floor(Date.now() / 1000) + 600, authenticated: false });
    const controller = make(api);
    await controller.load(MEDIUM);
    await settle(controller);
    expect(controller.getState().densify.target).toBeLessThan(64);
    expect(controller.getState().densify.limitReason).toMatch(/60 requests\/hour|leave GitHub requests/);
  });

  it('skips path probes entirely when unauthenticated', async () => {
    const api = new FakeApi({ bundles: BUNDLES, tokenConfigured: false });
    api.setRateLimit({ limit: 60, remaining: 50, resetAt: Math.floor(Date.now() / 1000) + 600, authenticated: false });
    const controller = make(api);
    await controller.load(TINY);
    await settle(controller);
    expect(api.countOf('probe')).toBe(0);
  });
});

describe('stale requests and repository switching', () => {
  it('discards the result of a load that was superseded', async () => {
    const api = new FakeApi({ bundles: BUNDLES, latency: Infinity });
    const controller = make(api);

    const first = controller.load(TINY);
    const second = controller.load(MEDIUM);
    api.releaseAll();
    // The gate has to be released repeatedly as each stage of the load starts.
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      api.releaseAll();
    }
    await Promise.all([first, second]);

    expect(controller.getState().ref?.slug).toBe(MEDIUM.slug);
    expect(controller.getState().meta?.slug).toBe('renrenmimi/DrillLab');
  });

  it('does not let a slow first repository overwrite the second one’s commits', async () => {
    const api = new FakeApi({ bundles: BUNDLES, latency: 20 });
    const controller = make(api);

    void controller.load(BIG);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await controller.load(TINY);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const state = controller.getState();
    expect(state.ref?.slug).toBe(TINY.slug);
    expect(state.commits).toHaveLength(5);
    expect(state.commits.every((commit) => commit.index < 5)).toBe(true);
  });

  it('clears trees and diffs from the previous repository', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM);
    await settle(controller);

    await controller.load(TINY);
    const state = controller.getState();
    expect(state.detailCount).toBeLessThanOrEqual(state.commits.length);
    // No file from DrillLab may survive into the new projection.
    const projected = [...controller.projector.project(state.commits.length - 1).files.keys()];
    expect(projected.some((path) => path.startsWith('components/arena-'))).toBe(false);
  });

  it('resets to the idle state', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(TINY);
    controller.reset();

    const state = controller.getState();
    expect(state.status).toBe('idle');
    expect(state.commits).toEqual([]);
    expect(state.meta).toBeNull();
    expect(state.milestones).toEqual([]);
    expect(state.playback.count).toBe(0);
  });

  it('is a no-op when asked to load the repository already shown', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const controller = make(api);
    await controller.load(TINY);
    const before = api.callCount;
    await controller.load(TINY);
    expect(api.callCount).toBe(before);
  });
});

describe('selection', () => {
  it('selects a commit named in the URL once its range has loaded', async () => {
    const api = new FakeApi({ bundles: BUNDLES });
    const probe = make(api);
    await probe.load(MEDIUM);
    const target = probe.getState().commits[10]!;

    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM, target.sha.slice(0, 7));
    expect(controller.getState().playback.index).toBe(10);
    expect(controller.currentCommit?.sha).toBe(target.sha);
  });

  it('falls back to the newest commit when the requested sha is not in range', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM, 'deadbee');
    expect(controller.getState().playback.index).toBe(63);
  });

  it('moves the playhead through dispatchPlayback', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM);
    controller.dispatchPlayback({ type: 'seek', index: 5 });
    expect(controller.getState().playback.index).toBe(5);
    controller.dispatchPlayback({ type: 'next' });
    expect(controller.getState().playback.index).toBe(6);
  });

  it('keeps the selected commit when the range grows underneath it', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(BIG);
    controller.dispatchPlayback({ type: 'seek', index: 12 });
    const selected = controller.currentCommit!.sha;

    await controller.loadOlder();
    expect(controller.currentCommit?.sha).toBe(selected);
  });
});

describe('derived data', () => {
  it('builds a growth series that only claims churn it has diffs for', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM);
    await settle(controller);

    const growth = controller.getState().growth!;
    expect(growth.points).toHaveLength(64);
    expect(growth.knownCommits).toBeLessThanOrEqual(64);
    expect(growth.coverage).toBeGreaterThan(0);
    for (const point of growth.points) {
      if (!point.known) expect(point.additions + point.deletions).toBe(0);
    }
  });

  it('grows the file count monotonically for a repository that only adds files', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(ONE);
    await settle(controller);
    const growth = controller.getState().growth!;
    expect(growth.points[0]?.fileCount).toBe(1);
  });

  it('detects milestones from the diffs it managed to load', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(MEDIUM);
    await settle(controller);
    expect(controller.getState().milestones.map((m) => m.kind)).toContain('initial-commit');
  });

  it('produces no derived data for an empty repository', async () => {
    const controller = make(new FakeApi({ bundles: BUNDLES }));
    await controller.load(EMPTY);
    const state = controller.getState();
    expect(state.milestones).toEqual([]);
    expect(state.growth).toBeNull();
  });
});

describe('planCheckpoints', () => {
  it('reads every commit when the budget allows it', () => {
    expect(planCheckpoints(4, 10)).toEqual([0, 1, 2, 3]);
  });

  it('always includes the oldest and newest commit', () => {
    const plan = planCheckpoints(300, 8);
    expect(plan[0]).toBe(0);
    expect(plan.at(-1)).toBe(299);
    expect(plan.length).toBeLessThanOrEqual(8);
  });

  it('spreads the remaining checkpoints evenly', () => {
    expect(planCheckpoints(101, 6)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('handles degenerate inputs', () => {
    expect(planCheckpoints(0, 5)).toEqual([]);
    expect(planCheckpoints(1, 5)).toEqual([0]);
    expect(planCheckpoints(50, 1)).toEqual([0, 49]);
  });
});

describe('error tolerance', () => {
  it('keeps the timeline usable when tags cannot be loaded', async () => {
    const api = new FakeApi({ bundles: BUNDLES, fail: { tags: notFound() } });
    const controller = make(api);
    await controller.load(TINY);
    await until(() => controller.getState().notices.length > 0, 2000);

    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().notices.join(' ')).toContain('Tags');
  });

  it('keeps the timeline usable when a tree request fails', async () => {
    const api = new FakeApi({ bundles: BUNDLES, fail: { tree: rateLimited() } });
    const controller = make(api);
    await controller.load(TINY);
    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().commits).toHaveLength(5);
  });
});
