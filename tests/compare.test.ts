import { describe, expect, it } from 'vitest';
import { compareLocalHistory, resolveLocalSha, type LocalCompareSource } from '@/lib/compare/local';
import {
  describeCompareChanges,
  describeCompareRelation,
  describeComparison,
} from '@/lib/compare/describe';
import type { CommitDetail, RepoCompare } from '@/lib/domain/types';
import {
  MAX_COMMIT_FILES,
  normaliseCompareStatus,
  toCompareEndpoint,
  toRepoCompare,
} from '@/lib/github/adapter';
import type { RawCompare } from '@/lib/github/raw-types';
import { commit, commits, detail, fileChange, rawCommit, sha } from './factories';

// ---------------------------------------------------------------- local ----

/**
 * A small linear history:
 *   0 add a.ts, b.ts   1 modify a.ts   2 add c.ts   3 remove b.ts   4 modify c.ts twice
 */
function history(): LocalCompareSource {
  const range = commits(5);
  const blobs = new Map<string, Map<string, string>>();
  const details = new Map<string, CommitDetail>();

  const state = new Map<string, string>();
  const steps: CommitDetail['files'][] = [
    [
      fileChange({ path: 'a.ts', status: 'added', additions: 10 }),
      fileChange({ path: 'b.ts', status: 'added', additions: 20 }),
    ],
    [fileChange({ path: 'a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-x\n+y' })],
    [fileChange({ path: 'c.ts', status: 'added', additions: 30 })],
    [fileChange({ path: 'b.ts', status: 'removed', additions: 0, deletions: 20 })],
    [fileChange({ path: 'c.ts', status: 'modified', additions: 5, deletions: 2 })],
  ];

  range.forEach((item, index) => {
    for (const file of steps[index]!) {
      if (file.status === 'removed') state.delete(file.path);
      // A new blob id on every touch, as a real tree would have.
      else state.set(file.path, sha(`blob-${file.path}-${index}`));
    }
    blobs.set(item.sha, new Map(state));
    details.set(item.sha, detail(item.sha, steps[index]!));
  });

  return {
    commits: range,
    snapshotAt: (value) => blobs.get(value) ?? null,
    detailOf: (value) => details.get(value) ?? null,
    tagOf: (value) => (value === range[2]!.sha ? 'v1.0.0' : null),
  };
}

const paths = (files: { path: string }[]) => files.map((file) => file.path);

describe('resolveLocalSha', () => {
  const range = commits(3);

  it('matches a full sha and an abbreviation', () => {
    expect(resolveLocalSha(range, range[1]!.sha)?.index).toBe(1);
    expect(resolveLocalSha(range, range[1]!.sha.slice(0, 7))?.index).toBe(1);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(resolveLocalSha(range, `  ${range[2]!.sha.slice(0, 8).toUpperCase()} `)?.index).toBe(2);
  });

  it('refuses an abbreviation too short to mean anything', () => {
    expect(resolveLocalSha(range, range[0]!.sha.slice(0, 3))).toBeNull();
  });

  it('returns null for a sha outside the history', () => {
    expect(resolveLocalSha(range, '0'.repeat(40))).toBeNull();
  });
});

describe('comparing two points of a known history', () => {
  it('reports an identical comparison with no changes', () => {
    const source = history();
    const result = compareLocalHistory(source, source.commits[2]!.sha, source.commits[2]!.sha)!;

    expect(result.status).toBe('identical');
    expect(result.aheadBy).toBe(0);
    expect(result.behindBy).toBe(0);
    expect(result.commits).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('reports the commits between two points, oldest first and re-indexed', () => {
    const source = history();
    const result = compareLocalHistory(source, source.commits[1]!.sha, source.commits[4]!.sha)!;

    expect(result.status).toBe('ahead');
    expect(result.aheadBy).toBe(3);
    expect(result.behindBy).toBe(0);
    expect(result.commits.map((item) => item.index)).toEqual([0, 1, 2]);
    // Strictly after base, up to and including head.
    expect(result.commits.map((item) => item.sha)).toEqual([
      source.commits[2]!.sha,
      source.commits[3]!.sha,
      source.commits[4]!.sha,
    ]);
    expect(result.commitsTruncated).toBe(false);
  });

  it('derives the net difference from the two trees, not from the diffs', () => {
    const source = history();
    // 1 -> 4: c.ts appears, b.ts goes, a.ts is untouched in that span.
    const result = compareLocalHistory(source, source.commits[1]!.sha, source.commits[4]!.sha)!;

    expect(paths(result.files)).toEqual(['b.ts', 'c.ts']);
    expect(result.files.find((file) => file.path === 'c.ts')?.status).toBe('added');
    expect(result.files.find((file) => file.path === 'b.ts')?.status).toBe('removed');
    expect(result.changedFiles).toBe(2);
  });

  it('does not list a file that was changed and then changed back to the same blob', () => {
    const range = commits(3);
    const stable = sha('blob-stable');
    const source: LocalCompareSource = {
      commits: range,
      snapshotAt: (value) =>
        new Map([
          ['x.ts', value === range[1]!.sha ? sha('blob-other') : stable],
        ]),
      detailOf: (value) =>
        detail(value, [fileChange({ path: 'x.ts', status: 'modified', additions: 1, deletions: 1 })]),
      tagOf: () => null,
    };

    const result = compareLocalHistory(source, range[0]!.sha, range[2]!.sha)!;
    // The blob id is the same at both ends, so nothing net changed.
    expect(result.files).toEqual([]);
  });

  it('sums line counts across every commit in the range', () => {
    const source = history();
    // c.ts: added (+30) at commit 2, modified (+5 -2) at commit 4.
    const result = compareLocalHistory(source, source.commits[1]!.sha, source.commits[4]!.sha)!;
    const c = result.files.find((file) => file.path === 'c.ts')!;
    expect(c.additions).toBe(35);
    expect(c.deletions).toBe(2);
  });

  it('offers a patch only when one recorded hunk is the whole net difference', () => {
    const source = history();

    // a.ts changed exactly once between 0 and 1, so that hunk is the difference.
    const single = compareLocalHistory(source, source.commits[0]!.sha, source.commits[1]!.sha)!;
    const a = single.files.find((file) => file.path === 'a.ts')!;
    expect(a.patch).toContain('@@');
    expect(a.patchOmittedReason).toBeNull();

    // c.ts changed twice between 1 and 4, so no single hunk describes it.
    const spanning = compareLocalHistory(source, source.commits[1]!.sha, source.commits[4]!.sha)!;
    const c = spanning.files.find((file) => file.path === 'c.ts')!;
    expect(c.patch).toBeNull();
    expect(c.patchOmittedReason).toBe('aggregated');
  });

  it('reverses direction when head precedes base', () => {
    const source = history();
    const forward = compareLocalHistory(source, source.commits[1]!.sha, source.commits[4]!.sha)!;
    const backward = compareLocalHistory(source, source.commits[4]!.sha, source.commits[1]!.sha)!;

    expect(backward.status).toBe('behind');
    expect(backward.behindBy).toBe(3);
    expect(backward.aheadBy).toBe(0);
    // No commits are "ahead" when going backwards.
    expect(backward.commits).toEqual([]);

    // The same files, with added and removed swapped and the counts mirrored.
    expect(paths(backward.files)).toEqual(paths(forward.files));
    expect(backward.files.find((file) => file.path === 'c.ts')?.status).toBe('removed');
    expect(backward.files.find((file) => file.path === 'b.ts')?.status).toBe('added');
    expect(backward.additions).toBe(forward.deletions);
    expect(backward.deletions).toBe(forward.additions);
  });

  it('never offers a patch for a backwards comparison, because the hunk reads the wrong way', () => {
    const source = history();
    const backward = compareLocalHistory(source, source.commits[1]!.sha, source.commits[0]!.sha)!;
    expect(backward.files.every((file) => file.patch === null)).toBe(true);
  });

  it('labels an endpoint that a tag points at', () => {
    const source = history();
    const result = compareLocalHistory(source, source.commits[0]!.sha, source.commits[2]!.sha)!;

    expect(result.base).toMatchObject({ kind: 'commit', tagName: null });
    expect(result.head).toMatchObject({ kind: 'tag', tagName: 'v1.0.0' });
  });

  it('reports the earlier point as the common ancestor of a linear history', () => {
    const source = history();
    const result = compareLocalHistory(source, source.commits[3]!.sha, source.commits[1]!.sha)!;
    expect(result.mergeBaseSha).toBe(source.commits[1]!.sha);
  });

  it('carries no comparison link, because a local comparison has no page', () => {
    const source = history();
    const result = compareLocalHistory(source, source.commits[0]!.sha, source.commits[1]!.sha)!;
    expect(result.htmlUrl).toBeNull();
    // An endpoint still links wherever its own commit does, which is nowhere for
    // the built-in demo and somewhere for a recorded fixture.
    expect(result.base.htmlUrl).toBe(source.commits[0]!.htmlUrl);
  });

  it('returns null when either side is not part of the history', () => {
    const source = history();
    expect(compareLocalHistory(source, '0'.repeat(40), source.commits[1]!.sha)).toBeNull();
    expect(compareLocalHistory(source, source.commits[1]!.sha, '0'.repeat(40))).toBeNull();
  });

  it('falls back to the recorded diffs, and says so, when a snapshot is missing', () => {
    const source = history();
    const degraded: LocalCompareSource = { ...source, snapshotAt: () => null };
    const result = compareLocalHistory(degraded, source.commits[1]!.sha, source.commits[4]!.sha)!;

    expect(result.filesTruncated).toBe(true);
    // Only paths the diffs mention can be described.
    expect(paths(result.files)).toEqual(['b.ts', 'c.ts']);
    expect(result.files.find((file) => file.path === 'b.ts')?.status).toBe('removed');
  });

  it('accepts abbreviated shas on both sides', () => {
    const source = history();
    const result = compareLocalHistory(
      source,
      source.commits[0]!.sha.slice(0, 7),
      source.commits[2]!.sha.slice(0, 7),
    )!;
    expect(result.status).toBe('ahead');
    expect(result.aheadBy).toBe(2);
  });
});

// --------------------------------------------------------------- adapter ----

describe('normaliseCompareStatus', () => {
  it.each(['identical', 'ahead', 'behind', 'diverged'])('keeps %s', (value) => {
    expect(normaliseCompareStatus(value)).toBe(value);
  });

  it('treats anything unrecognised as diverged rather than guessing', () => {
    expect(normaliseCompareStatus('sideways')).toBe('diverged');
    expect(normaliseCompareStatus('')).toBe('diverged');
  });
});

describe('toCompareEndpoint', () => {
  it('marks an endpoint chosen by tag', () => {
    const source = commit({ index: 0 });
    expect(toCompareEndpoint(source, 'v2.1.0')).toMatchObject({ kind: 'tag', tagName: 'v2.1.0' });
    expect(toCompareEndpoint(source, null)).toMatchObject({ kind: 'commit', tagName: null });
  });
});

describe('toRepoCompare', () => {
  const baseSha = sha('base');
  const headSha = sha('head');

  function raw(overrides: Partial<RawCompare> = {}): RawCompare {
    return {
      status: 'ahead',
      ahead_by: 2,
      behind_by: 0,
      total_commits: 2,
      html_url: 'https://github.com/owner/repo/compare/a...b',
      base_commit: rawCommit({ sha: baseSha }),
      merge_base_commit: rawCommit({ sha: baseSha }),
      commits: [rawCommit({ sha: sha('mid') }), rawCommit({ sha: headSha })],
      files: [
        { filename: 'a.ts', status: 'modified', additions: 4, deletions: 1, changes: 5, patch: '@@ -1 +1 @@' },
        { filename: 'b.ts', status: 'added', additions: 9, deletions: 0, changes: 9, patch: null },
      ],
      ...overrides,
    };
  }

  it('maps status, counts and both endpoints', () => {
    const result = toRepoCompare(raw(), {
      requestedHeadSha: headSha,
      labels: { base: null, head: 'v3.0.0' },
    });

    expect(result.status).toBe('ahead');
    expect(result.aheadBy).toBe(2);
    expect(result.base.sha).toBe(baseSha);
    expect(result.head.sha).toBe(headSha);
    expect(result.head.tagName).toBe('v3.0.0');
    expect(result.mergeBaseSha).toBe(baseSha);
    expect(result.htmlUrl).toContain('/compare/');
  });

  it('sums line counts from the mapped files', () => {
    const result = toRepoCompare(raw(), { requestedHeadSha: headSha, labels: { base: null, head: null } });
    expect(result.additions).toBe(13);
    expect(result.deletions).toBe(1);
    expect(result.changedFiles).toBe(2);
  });

  it('identifies head from the caller when the commit list cannot', () => {
    // Head is an ancestor of base: GitHub returns no commits at all.
    const headCommit = commit({ index: 0, sha: headSha, subject: 'the head commit' });
    const result = toRepoCompare(
      raw({ status: 'behind', ahead_by: 0, behind_by: 3, total_commits: 0, commits: [], files: [] }),
      { requestedHeadSha: headSha, headCommit, labels: { base: null, head: null } },
    );

    expect(result.status).toBe('behind');
    expect(result.behindBy).toBe(3);
    expect(result.head.sha).toBe(headSha);
    expect(result.head.subject).toBe('the head commit');
  });

  it('falls back to the bare sha rather than inventing a head', () => {
    const result = toRepoCompare(
      raw({ commits: [], total_commits: 0 }),
      { requestedHeadSha: headSha, headCommit: null, labels: { base: null, head: null } },
    );

    expect(result.head.sha).toBe(headSha);
    expect(result.head.subject).toBe('');
    expect(result.head.authorName).toBe('');
    expect(result.head.date).toBe('');
  });

  it('takes head from the commit list when the last entry matches an abbreviation', () => {
    const result = toRepoCompare(raw(), {
      requestedHeadSha: headSha.slice(0, 7),
      labels: { base: null, head: null },
    });
    expect(result.head.sha).toBe(headSha);
    expect(result.head.subject).not.toBe('');
  });

  it('flags a commit list GitHub truncated', () => {
    const result = toRepoCompare(raw({ total_commits: 900 }), {
      requestedHeadSha: headSha,
      labels: { base: null, head: null },
    });
    expect(result.commitsTruncated).toBe(true);
    expect(result.commits).toHaveLength(2);
  });

  it('flags a file list at GitHub’s own cap', () => {
    const files = Array.from({ length: MAX_COMMIT_FILES }, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: null,
    }));
    const result = toRepoCompare(raw({ files }), {
      requestedHeadSha: headSha,
      labels: { base: null, head: null },
    });
    expect(result.filesTruncated).toBe(true);
    expect(result.files).toHaveLength(MAX_COMMIT_FILES);
  });

  it('survives a payload with no commits and no files', () => {
    const result = toRepoCompare(
      raw({ status: 'identical', ahead_by: 0, behind_by: 0, total_commits: 0, commits: null, files: null }),
      { requestedHeadSha: baseSha, labels: { base: null, head: null } },
    );
    expect(result.status).toBe('identical');
    expect(result.files).toEqual([]);
    expect(result.commits).toEqual([]);
    expect(result.commitsTruncated).toBe(false);
  });
});

// ------------------------------------------------------------- description ----

describe('the spoken description of a comparison', () => {
  /**
   * Built from the real comparison of a known history, so the sentence is checked
   * against the same object the interface renders — including which end is which.
   */
  const source = history();
  const older = source.commits[1]!;
  const newer = source.commits[4]!;

  it('puts head first and base last, in that order', () => {
    const compare = compareLocalHistory(source, older.sha, newer.sha)!;
    const sentence = describeCompareRelation(compare);

    // Head is the subject of the sentence; base is what it is measured against.
    expect(sentence.indexOf(newer.shortSha)).toBeLessThan(sentence.indexOf(older.shortSha));
    expect(sentence.startsWith(newer.shortSha)).toBe(true);
    expect(sentence.endsWith(`${older.shortSha}.`)).toBe(true);
  });

  it('describes an ahead comparison from head’s point of view', () => {
    const compare = compareLocalHistory(source, older.sha, newer.sha)!;
    expect(compare.status).toBe('ahead');
    expect(compare.aheadBy).toBe(3);

    expect(describeCompareRelation(compare)).toBe(
      `${newer.shortSha} is 3 commits ahead of ${older.shortSha}.`,
    );
  });

  it('describes a behind comparison after the ends are swapped', () => {
    // Exactly what the swap button produces: the same pair, the other way round.
    const compare = compareLocalHistory(source, newer.sha, older.sha)!;
    expect(compare.status).toBe('behind');
    expect(compare.behindBy).toBe(3);

    expect(describeCompareRelation(compare)).toBe(
      `${older.shortSha} is 3 commits behind ${newer.shortSha}.`,
    );
    // "behind of" was the old, ungrammatical shape.
    expect(describeCompareRelation(compare)).not.toContain('behind of');
  });

  it('describes an identical comparison without pretending anything moved', () => {
    const compare = compareLocalHistory(source, newer.sha, newer.sha)!;
    expect(compare.status).toBe('identical');

    expect(describeCompareRelation(compare)).toBe(
      `${newer.shortSha} and ${newer.shortSha} identify the same commit.`,
    );
    expect(describeCompareRelation(compare)).not.toContain('identical of');
    expect(describeCompareChanges(compare)).toBe('No file differs between them.');
  });

  it('describes a diverged comparison with both distances', () => {
    // A linear history never diverges, so this one is stated directly.
    const compare: RepoCompare = {
      ...compareLocalHistory(source, older.sha, newer.sha)!,
      status: 'diverged',
      aheadBy: 3,
      behindBy: 5,
    };

    expect(describeCompareRelation(compare)).toBe(
      `${newer.shortSha} is 3 commits ahead of and 5 commits behind ${older.shortSha}.`,
    );
    expect(describeCompareRelation(compare)).not.toContain('diverged of');
  });

  it('never says the old, reversed sentence', () => {
    for (const [a, b] of [
      [older.sha, newer.sha],
      [newer.sha, older.sha],
      [newer.sha, newer.sha],
    ]) {
      const compare = compareLocalHistory(source, a!, b!)!;
      const sentence = describeComparison(compare);
      // The template that produced "base is ahead of head" is gone.
      expect(sentence).not.toBe(
        `${compare.base.shortSha} is ${compare.status} of ${compare.head.shortSha}:`,
      );
      expect(sentence).not.toMatch(/is (ahead|behind|identical|diverged) of [0-9a-f]{7}:/);
    }
  });

  it('appends the file and line totals of that same comparison', () => {
    const compare = compareLocalHistory(source, older.sha, newer.sha)!;
    expect(describeCompareChanges(compare)).toBe(
      `${compare.changedFiles} files changed, ${compare.additions} lines added and ${compare.deletions} removed.`,
    );
    expect(describeComparison(compare)).toBe(
      `${describeCompareRelation(compare)} ${describeCompareChanges(compare)}`,
    );
  });

  it('uses singular nouns for a count of one', () => {
    const single = compareLocalHistory(source, source.commits[0]!.sha, source.commits[1]!.sha)!;
    expect(single.aheadBy).toBe(1);
    expect(describeCompareRelation(single)).toContain('1 commit ahead of');
    expect(describeCompareRelation(single)).not.toContain('1 commits');
    expect(describeCompareChanges(single)).toBe('1 file changed, 3 lines added and 1 removed.');
  });

  it('separates thousands, matching the numbers on screen', () => {
    const compare: RepoCompare = {
      ...compareLocalHistory(source, older.sha, newer.sha)!,
      aheadBy: 1234,
      changedFiles: 2048,
      additions: 12760,
      deletions: 509,
    };
    const sentence = describeComparison(compare);
    expect(sentence).toContain('1,234 commits ahead of');
    expect(sentence).toContain('2,048 files changed');
    expect(sentence).toContain('12,760 lines added and 509 removed');
  });
});
