import { describe, expect, it, vi } from 'vitest';
import { DedupedCache, Lru } from '@/lib/cache/lru';
import { areaOf, buildActivityMap, buildGrowthSeries, estimateLanguages } from '@/lib/stats/growth';
import { TreeProjector } from '@/lib/tree/projector';
import type { FileSet } from '@/lib/tree/build';
import { commits, detail, fileChange, tree } from './factories';
import { parseLinkHeader, pageFromLink, parseRateLimit } from '@/lib/github/client';
import { readRateLimit, recordRateLimit, resetRateLimitStore } from '@/lib/github/rate-limit-store';

describe('Lru', () => {
  it('evicts the least recently used entry', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.has('b')).toBe(false);
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('never exceeds its capacity', () => {
    const lru = new Lru<number, number>(3);
    for (let i = 0; i < 50; i += 1) lru.set(i, i);
    expect(lru.size).toBe(3);
  });

  it('refuses a nonsensical capacity', () => {
    expect(() => new Lru(0)).toThrow(RangeError);
  });

  it('clears and deletes', () => {
    const lru = new Lru<string, number>(4);
    lru.set('a', 1);
    lru.delete('a');
    expect(lru.has('a')).toBe(false);
    lru.set('b', 2);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});

describe('DedupedCache', () => {
  it('runs the loader once for concurrent callers', async () => {
    const cache = new DedupedCache<number>(8);
    const loader = vi.fn(async () => 42);
    const results = await Promise.all([
      cache.load('k', loader),
      cache.load('k', loader),
      cache.load('k', loader),
    ]);
    expect(results).toEqual([42, 42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves a cached value without calling the loader again', async () => {
    const cache = new DedupedCache<number>(8);
    await cache.load('k', async () => 1);
    const loader = vi.fn(async () => 2);
    expect(await cache.load('k', loader)).toBe(1);
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not cache a failure, so a retry is possible', async () => {
    const cache = new DedupedCache<number>(8);
    await expect(cache.load('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await cache.load('k', async () => 7)).toBe(7);
  });

  it('drops in-flight bookkeeping once settled', async () => {
    const cache = new DedupedCache<number>(8);
    await cache.load('k', async () => 1);
    expect(cache.inFlightCount).toBe(0);
  });
});

describe('buildGrowthSeries', () => {
  it('tracks the file count and only counts churn it has diffs for', () => {
    const range = commits(4);
    const projector = new TreeProjector();
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    projector.addDetail(range[1]!.sha, detail(range[1]!.sha, [fileChange({ path: 'b.ts', status: 'added', additions: 20 })]));
    projector.addDetail(
      range[3]!.sha,
      detail(range[3]!.sha, [fileChange({ path: 'b.ts', status: 'removed', additions: 0, deletions: 20 })]),
    );

    const series = buildGrowthSeries(range, projector);
    expect(series.points).toHaveLength(4);
    expect(series.points[0]?.fileCount).toBe(1);
    expect(series.points[1]?.fileCount).toBe(2);
    expect(series.points[1]?.additions).toBe(20);
    // Commit 2 has no diff, so its churn is unknown rather than zero-with-confidence.
    expect(series.points[2]?.known).toBe(false);
    expect(series.points[2]?.additions).toBe(0);
    expect(series.knownCommits).toBe(2);
    expect(series.coverage).toBeCloseTo(0.5);
    expect(series.totalAdditions).toBe(20);
    expect(series.totalDeletions).toBe(20);
  });

  it('produces an empty series for no commits', () => {
    const series = buildGrowthSeries([], new TreeProjector());
    expect(series.points).toEqual([]);
    expect(series.coverage).toBe(0);
  });

  it('reports the peak values the chart needs to scale itself', () => {
    const range = commits(3);
    const projector = new TreeProjector();
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts', 'b.ts', 'c.ts']));
    projector.addDetail(range[1]!.sha, detail(range[1]!.sha, [fileChange({ path: 'a.ts', additions: 5, deletions: 3 })]));

    const series = buildGrowthSeries(range, projector);
    expect(series.maxFiles).toBe(3);
    expect(series.maxChurn).toBe(8);
  });
});

describe('estimateLanguages', () => {
  const set = (entries: [string, number | null][]): FileSet =>
    new Map(entries.map(([path, size]) => [path, { size, sha: null }]));

  it('counts files by extension and reports shares', () => {
    const estimate = estimateLanguages(
      set([
        ['a.ts', 100],
        ['b.ts', 200],
        ['c.py', 50],
      ]),
    );
    expect(estimate.countedFiles).toBe(3);
    const typescript = estimate.slices.find((slice) => slice.language === 'TypeScript');
    expect(typescript?.files).toBe(2);
    expect(typescript?.bytes).toBe(300);
    expect(typescript?.share).toBeCloseTo(2 / 3);
  });

  it('excludes binary and generated files on purpose, and says how many', () => {
    const estimate = estimateLanguages(
      set([
        ['a.ts', 10],
        ['logo.png', 900],
        ['package-lock.json', 5000],
        ['node_modules/x/index.js', 20],
      ]),
    );
    expect(estimate.countedFiles).toBe(1);
    expect(estimate.excluded).toBe(3);
  });

  it('counts files it cannot classify separately, rather than guessing', () => {
    const estimate = estimateLanguages(set([['LICENSE', 1000], ['a.ts', 10]]));
    expect(estimate.unclassified).toBe(1);
    expect(estimate.countedFiles).toBe(1);
  });

  it('flags partial byte totals when sizes are unknown', () => {
    const estimate = estimateLanguages(set([['a.ts', null], ['b.ts', 100]]));
    expect(estimate.bytesPartial).toBe(true);
  });

  it('groups the long tail so the legend stays readable', () => {
    const languages = ['ts', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'cs', 'ex', 'dart'];
    const estimate = estimateLanguages(set(languages.map((extension, i) => [`f${i}.${extension}`, 10])));
    expect(estimate.slices.length).toBeLessThanOrEqual(9);
    expect(estimate.slices.at(-1)?.language).toMatch(/other$/);
    const total = estimate.slices.reduce((sum, slice) => sum + slice.files, 0);
    expect(total).toBe(estimate.countedFiles);
  });

  it('handles an empty file set', () => {
    const estimate = estimateLanguages(new Map());
    expect(estimate.slices).toEqual([]);
    expect(estimate.countedFiles).toBe(0);
  });
});

describe('buildActivityMap', () => {
  it('attributes changed files to their top-level directory, in time buckets', () => {
    const range = commits(8);
    const details = new Map([
      [range[0]!.sha, detail(range[0]!.sha, [fileChange({ path: 'src/a.ts' }), fileChange({ path: 'src/b.ts' })])],
      [range[7]!.sha, detail(range[7]!.sha, [fileChange({ path: 'docs/x.md' })])],
    ]);

    const map = buildActivityMap(range, details, 4);
    expect(map.areas).toEqual(expect.arrayContaining(['src', 'docs']));
    expect(map.bucketCount).toBe(4);
    expect(map.knownCommits).toBe(2);
    expect(map.max).toBe(2);

    const first = map.cells.find((cell) => cell.area === 'src' && cell.bucket === 0);
    const last = map.cells.find((cell) => cell.area === 'docs' && cell.bucket === 3);
    expect(first?.changes).toBe(2);
    expect(last?.changes).toBe(1);
  });

  it('covers every commit index across its buckets', () => {
    const range = commits(10);
    const map = buildActivityMap(range, new Map([[range[0]!.sha, detail(range[0]!.sha, [fileChange({ path: 'a.ts' })])]]), 3);
    expect(map.buckets[0]?.fromIndex).toBe(0);
    expect(map.buckets.at(-1)?.toIndex).toBe(9);
    for (const bucket of map.buckets) expect(bucket.toIndex).toBeGreaterThanOrEqual(bucket.fromIndex);
  });

  it('never asks for more buckets than there are commits', () => {
    const range = commits(3);
    expect(buildActivityMap(range, new Map(), 24).bucketCount).toBe(3);
  });

  it('returns nothing for an empty range', () => {
    const map = buildActivityMap([], new Map());
    expect(map.areas).toEqual([]);
    expect(map.cells).toEqual([]);
  });

  it('groups areas beyond the top few under "other"', () => {
    const range = commits(1);
    const files = Array.from({ length: 12 }, (_, i) => fileChange({ path: `dir${i}/f.ts` }));
    const map = buildActivityMap(range, new Map([[range[0]!.sha, detail(range[0]!.sha, files)]]), 1);
    expect(map.areas).toContain('other');
    expect(map.areas.length).toBeLessThanOrEqual(8);
  });
});

describe('areaOf', () => {
  it('names the top-level directory, or the root', () => {
    expect(areaOf('src/app/page.tsx')).toBe('src');
    expect(areaOf('README.md')).toBe('/');
  });
});

describe('Link header parsing', () => {
  it('reads the rels GitHub sends', () => {
    const header =
      '<https://api.github.com/repositories/1/commits?page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/commits?page=7>; rel="last"';
    const links = parseLinkHeader(header);
    expect(links.next).toContain('page=2');
    expect(pageFromLink(links.last)).toBe(7);
  });

  it('treats a missing or unparseable header as no pagination', () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader('garbage')).toEqual({});
    expect(pageFromLink(undefined)).toBeNull();
    expect(pageFromLink('not-a-url')).toBeNull();
  });
});

describe('rate-limit parsing and storage', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('reads the three headers together, or not at all', () => {
    const snapshot = parseRateLimit(
      headers({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4870', 'x-ratelimit-reset': '1790000000' }),
      true,
    );
    expect(snapshot).toEqual({ limit: 5000, remaining: 4870, resetAt: 1790000000, authenticated: true });
    expect(parseRateLimit(headers({ 'x-ratelimit-limit': '5000' }), false)).toBeNull();
  });

  it('remembers the newest snapshot with the time it was observed', () => {
    resetRateLimitStore();
    const future = Math.floor(Date.now() / 1000) + 600;
    recordRateLimit({ limit: 60, remaining: 40, resetAt: future, authenticated: false });
    const read = readRateLimit();
    expect(read.snapshot?.remaining).toBe(40);
    expect(read.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('ignores a snapshot whose window has already reset', () => {
    resetRateLimitStore();
    recordRateLimit({ limit: 60, remaining: 40, resetAt: Math.floor(Date.now() / 1000) - 10, authenticated: false });
    expect(readRateLimit().snapshot).toBeNull();
  });

  it('reports nothing before any response has been seen', () => {
    resetRateLimitStore();
    expect(readRateLimit()).toEqual({ snapshot: null, ageMs: null });
  });
});

describe('growth series honesty', () => {
  it('marks a file count as carried forward when the diffs behind it are missing', () => {
    const range = commits(5);
    const projector = new TreeProjector();
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));

    const series = buildGrowthSeries(range, projector);
    expect(series.points[0]?.measured).toBe(true);
    // Nothing after the snapshot has a diff, so those counts are carried forward.
    expect(series.points.slice(1).every((point) => point.measured === false)).toBe(true);
  });

  it('marks a file count as measured once the chain of diffs is complete', () => {
    const range = commits(3);
    const projector = new TreeProjector();
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    projector.addDetail(range[1]!.sha, detail(range[1]!.sha, [fileChange({ path: 'b.ts', status: 'added' })]));
    projector.addDetail(range[2]!.sha, detail(range[2]!.sha, [fileChange({ path: 'c.ts', status: 'added' })]));

    const series = buildGrowthSeries(range, projector);
    expect(series.points.every((point) => point.measured)).toBe(true);
    expect(series.points.at(-1)?.fileCount).toBe(3);
  });
});
