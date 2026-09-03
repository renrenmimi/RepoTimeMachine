import { describe, expect, it } from 'vitest';
import {
  builtinCommitDetail,
  builtinCommitPage,
  builtinCompare,
  builtinTree,
} from '@/lib/builtin/provider';
import { DEMO_COMMITS } from '@/lib/builtin/learning-platform';
import { diffLines, toLines } from '@/lib/diff/unified';
import type { FileChange, RepoTree } from '@/lib/domain/types';
import { classifyPath } from '@/lib/tree/classify';

/**
 * The built-in demo, verified against itself.
 *
 * Every number the demo shows is derived from file content by the provider, so
 * these tests check the one thing that could still be wrong: that the derivation
 * is self-consistent. A patch that does not produce the tree it claims to, or a
 * line count that does not match its own hunks, is caught here rather than by a
 * visitor expanding a file.
 */

const commits = [...builtinCommitPage(1, 100).commits].reverse().map((commit, index) => ({
  ...commit,
  index,
}));

/** Reasons that mean "there is content, and it is deliberately not shown". */
const WITHHELD = new Set(['generated', 'binary']);

function blobs(tree: RepoTree): Map<string, { size: number; sha: string }> {
  const out = new Map<string, { size: number; sha: string }>();
  for (const entry of tree.entries) {
    if (entry.type === 'blob') out.set(entry.path, { size: entry.size ?? -1, sha: entry.sha });
  }
  return out;
}

/** Applies a unified diff to a line array. Throws if the patch does not fit. */
function applyPatch(before: string[], patch: string): string[] {
  const out: string[] = [];
  let cursor = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+/.exec(raw);
      if (!match) throw new Error(`unparsable hunk header: ${raw}`);
      const oldStart = Number(match[1]);
      const target = oldStart === 0 ? cursor : oldStart - 1;
      if (target < cursor) throw new Error(`hunk goes backwards: ${raw}`);
      while (cursor < target) {
        out.push(before[cursor]!);
        cursor += 1;
      }
      continue;
    }
    const kind = raw[0];
    const line = raw.slice(1);
    if (kind === ' ') {
      if (before[cursor] !== line) {
        throw new Error(`context does not match at line ${cursor + 1}: ${JSON.stringify(line)}`);
      }
      out.push(line);
      cursor += 1;
    } else if (kind === '-') {
      if (before[cursor] !== line) {
        throw new Error(`removal does not match at line ${cursor + 1}: ${JSON.stringify(line)}`);
      }
      cursor += 1;
    } else if (kind === '+') {
      out.push(line);
    }
  }

  while (cursor < before.length) {
    out.push(before[cursor]!);
    cursor += 1;
  }
  return out;
}

describe('every commit in the demo has real, consistent diffs', () => {
  it('offers sixteen commits, each with at least one changed file', () => {
    expect(commits).toHaveLength(16);
    for (const commit of commits) {
      expect(builtinCommitDetail(commit.sha)!.files.length, commit.subject).toBeGreaterThan(0);
    }
  });

  it('gives every ordinary text file a real unified diff', () => {
    const withheld: string[] = [];
    let withPatch = 0;

    for (const commit of commits) {
      for (const file of builtinCommitDetail(commit.sha)!.files) {
        if (file.patch !== null) {
          withPatch += 1;
          expect(file.patch, `${commit.shortSha} ${file.path}`).toMatch(/^@@ -\d/);
          expect(file.patchOmittedReason).toBeNull();
          continue;
        }
        withheld.push(`${commit.index + 1}:${file.path}:${file.patchOmittedReason}`);
      }
    }

    // The whole point of this change: almost everything is now expandable.
    expect(withPatch).toBeGreaterThan(110);

    // And the exceptions are exactly the two declared files and the pure renames.
    for (const entry of withheld) {
      expect(entry).toMatch(/:(generated|binary|rename-only)$/);
    }
  });

  it('never falls back to the generic "not provided" reason', () => {
    // That reason is honest for a live repository, which cannot be asked twice.
    // For data the application ships itself it would only mean "unfinished".
    for (const commit of commits) {
      for (const file of builtinCommitDetail(commit.sha)!.files) {
        expect(file.patchOmittedReason, `${commit.shortSha} ${file.path}`).not.toBe('not-provided');
        expect(file.patchOmittedReason).not.toBe('aggregated');
      }
    }
  });

  it('counts additions and deletions from its own hunks', () => {
    for (const commit of commits) {
      const detail = builtinCommitDetail(commit.sha)!;

      for (const file of detail.files) {
        if (file.patch === null) continue;
        const plus = file.patch.split('\n').filter((line) => line.startsWith('+')).length;
        const minus = file.patch.split('\n').filter((line) => line.startsWith('-')).length;
        expect(file.additions, `${commit.shortSha} ${file.path} additions`).toBe(plus);
        expect(file.deletions, `${commit.shortSha} ${file.path} deletions`).toBe(minus);
      }

      // And the commit total is the sum of its files, not a separate number.
      expect(detail.additions).toBe(detail.files.reduce((sum, file) => sum + file.additions, 0));
      expect(detail.deletions).toBe(detail.files.reduce((sum, file) => sum + file.deletions, 0));
      expect(detail.changedFiles).toBe(detail.files.length);
    }
  });

  it('applies each patch onto the previous tree and lands on the new one', () => {
    /*
     * The strongest statement available: replaying every patch in order
     * reconstructs the file content at every commit, so the diffs and the trees
     * describe the same history rather than two histories that happen to agree
     * on the file names.
     */
    const content = new Map<string, string[]>();

    for (const commit of commits) {
      const detail = builtinCommitDetail(commit.sha)!;

      for (const file of detail.files) {
        if (file.status === 'removed') {
          content.delete(file.path);
          continue;
        }
        const from = file.previousPath ?? file.path;
        const before = content.get(from) ?? [];
        if (file.previousPath) content.delete(file.previousPath);

        if (file.patch === null) {
          // A withheld or unchanged file keeps whatever it had.
          content.set(file.path, before);
          continue;
        }
        content.set(file.path, applyPatch(before, file.patch));
      }

      const tree = blobs(builtinTree(commit.sha)!);
      const replayed = [...content.keys()].sort();
      const declared = [...tree.keys()].sort();
      expect(replayed, `paths at commit ${commit.index + 1}`).toEqual(declared);
    }
  });

  it('matches every tree size to the bytes of the content it holds', () => {
    for (const commit of commits) {
      const tree = builtinTree(commit.sha)!;
      for (const entry of tree.entries) {
        if (entry.type !== 'blob') continue;
        expect(entry.size, `${commit.shortSha} ${entry.path}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives a file the same blob id whenever it holds the same bytes', () => {
    // Content-addressed like Git, which is what lets a comparison between two
    // points tell "touched and reverted" apart from "changed".
    const byContent = new Map<string, Set<string>>();

    for (const commit of commits) {
      const tree = builtinTree(commit.sha)!;
      for (const entry of tree.entries) {
        if (entry.type !== 'blob') continue;
        const seen = byContent.get(`${entry.path}:${entry.size}`) ?? new Set<string>();
        seen.add(entry.sha);
        byContent.set(`${entry.path}:${entry.size}`, seen);
      }
    }

    // A path whose size never changed should not have acquired new ids for it.
    for (const [key, ids] of byContent) {
      if (key.startsWith('package-lock.json') || key.includes('search-index.json')) continue;
      expect(ids.size, `${key} has ${ids.size} distinct blob ids`).toBe(1);
    }
  });

  it('states a withheld file as generated, and labels the path that way too', () => {
    const withheldPaths = new Set<string>();

    for (const commit of commits) {
      for (const file of builtinCommitDetail(commit.sha)!.files) {
        if (file.patchOmittedReason && WITHHELD.has(file.patchOmittedReason)) {
          withheldPaths.add(file.path);
        }
      }
    }

    expect([...withheldPaths].sort()).toEqual([
      'package-lock.json',
      'public/generated/search-index.json',
    ]);

    // The row can be marked before it is expanded, because the path itself says so.
    for (const path of withheldPaths) {
      const facts = classifyPath(path);
      expect(facts.isGenerated || facts.isBinary, path).toBe(true);
      expect(facts.kind === 'generated' || facts.kind === 'binary').toBe(true);
    }
  });

  it('describes a pure rename as a rename rather than a missing diff', () => {
    const renames = commits
      .flatMap((commit) => builtinCommitDetail(commit.sha)!.files)
      .filter((file) => file.status === 'renamed');

    expect(renames.length).toBeGreaterThan(0);
    for (const file of renames) {
      expect(file.previousPath).toBeTruthy();
      if (file.patch === null) expect(file.patchOmittedReason).toBe('rename-only');
    }
  });

  it('touches every path the fixture declares, and nothing else', () => {
    const fromFixture = new Set(DEMO_COMMITS.flatMap((spec) => spec.files.map((op) => op.path)));
    const fromDetails = new Set(
      commits.flatMap((commit) => builtinCommitDetail(commit.sha)!.files.map((file) => file.path)),
    );
    expect([...fromDetails].sort()).toEqual([...fromFixture].sort());
  });
});

describe('comparing any two points of the demo', () => {
  const pairs: [number, number][] = [];
  for (let base = 0; base < commits.length; base += 1) {
    for (let head = 0; head < commits.length; head += 1) {
      pairs.push([base, head]);
    }
  }

  it('covers all 256 ordered pairs', () => {
    expect(pairs).toHaveLength(256);
  });

  it('returns a net difference for every pair', () => {
    for (const [baseIndex, headIndex] of pairs) {
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha);
      expect(compare, `${baseIndex + 1}..${headIndex + 1}`).not.toBeNull();
    }
  });

  it('gives every text file in a comparison a real diff', () => {
    for (const [baseIndex, headIndex] of pairs) {
      if (baseIndex === headIndex) continue;
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;

      for (const file of compare.files) {
        const label = `${baseIndex + 1}..${headIndex + 1} ${file.path}`;
        if (file.patch !== null) {
          expect(file.patch, label).toMatch(/^@@ -\d/);
          continue;
        }
        // The only reasons a comparison may withhold one.
        expect(file.patchOmittedReason, label).toMatch(/^(generated|binary|rename-only)$/);
      }
    }
  });

  it('never reports an aggregated total in place of a net diff', () => {
    // Live GitHub still does, honestly. Data the application ships does not need to.
    for (const [baseIndex, headIndex] of pairs) {
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;
      for (const file of compare.files) {
        expect(file.patchOmittedReason).not.toBe('aggregated');
        expect(file.patchOmittedReason).not.toBe('not-provided');
      }
    }
  });

  it('matches the net diff to the two trees it compares', () => {
    for (const [baseIndex, headIndex] of pairs) {
      if (baseIndex === headIndex) continue;
      const base = commits[baseIndex]!;
      const head = commits[headIndex]!;
      const compare = builtinCompare(base.sha, head.sha)!;

      const baseBlobs = blobs(builtinTree(base.sha)!);
      const headBlobs = blobs(builtinTree(head.sha)!);
      const label = `${baseIndex + 1}..${headIndex + 1}`;

      const expected = new Set<string>();
      for (const path of new Set([...baseBlobs.keys(), ...headBlobs.keys()])) {
        const inBase = baseBlobs.get(path);
        const inHead = headBlobs.get(path);
        if (inBase && inHead && inBase.sha === inHead.sha) continue;
        expected.add(path);
      }

      expect(new Set(compare.files.map((file) => file.path)), label).toEqual(expected);
      expect(compare.changedFiles, label).toBe(compare.files.length);
    }
  });

  it('reports statuses that agree with the two trees', () => {
    for (const [baseIndex, headIndex] of pairs) {
      if (baseIndex === headIndex) continue;
      const base = commits[baseIndex]!;
      const head = commits[headIndex]!;
      const compare = builtinCompare(base.sha, head.sha)!;
      const baseBlobs = blobs(builtinTree(base.sha)!);
      const headBlobs = blobs(builtinTree(head.sha)!);

      for (const file of compare.files) {
        const label = `${baseIndex + 1}..${headIndex + 1} ${file.path}`;
        const inBase = baseBlobs.has(file.path);
        const inHead = headBlobs.has(file.path);
        if (!inBase && inHead) expect(file.status, label).toBe('added');
        else if (inBase && !inHead) expect(file.status, label).toBe('removed');
        else expect(['modified', 'renamed'], label).toContain(file.status);
      }
    }
  });

  it('sums its own file counts into its totals', () => {
    for (const [baseIndex, headIndex] of pairs) {
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;
      const label = `${baseIndex + 1}..${headIndex + 1}`;
      expect(compare.additions, label).toBe(
        compare.files.reduce((sum, file) => sum + file.additions, 0),
      );
      expect(compare.deletions, label).toBe(
        compare.files.reduce((sum, file) => sum + file.deletions, 0),
      );
    }
  });

  it('counts every comparison diff from its own hunks', () => {
    for (const [baseIndex, headIndex] of pairs) {
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;
      for (const file of compare.files) {
        if (file.patch === null) continue;
        const plus = file.patch.split('\n').filter((line) => line.startsWith('+')).length;
        const minus = file.patch.split('\n').filter((line) => line.startsWith('-')).length;
        expect(file.additions, `${baseIndex + 1}..${headIndex + 1} ${file.path}`).toBe(plus);
        expect(file.deletions).toBe(minus);
      }
    }
  });

  it('applies a comparison patch onto the base content and lands on the head', () => {
    // The net diff has to be the difference, not a plausible-looking hunk.
    const content = contentByCommit();

    for (const [baseIndex, headIndex] of [
      [0, 15],
      [0, 8],
      [3, 12],
      [7, 9],
      [14, 15],
      [1, 2],
    ] as [number, number][]) {
      const base = commits[baseIndex]!;
      const head = commits[headIndex]!;
      const compare = builtinCompare(base.sha, head.sha)!;
      const atBase = content.get(base.sha)!;
      const atHead = content.get(head.sha)!;

      for (const file of compare.files) {
        if (file.patch === null) continue;
        const label = `${baseIndex + 1}..${headIndex + 1} ${file.path}`;
        const from = toLines(atBase.get(file.previousPath ?? file.path) ?? '');
        const to = toLines(atHead.get(file.path) ?? '');
        expect(applyPatch(from, file.patch), label).toEqual(to);
      }
    }
  });

  it('swaps additions, deletions and statuses when the direction is reversed', () => {
    for (const [baseIndex, headIndex] of [
      [0, 15],
      [2, 9],
      [5, 6],
      [10, 13],
    ] as [number, number][]) {
      const forward = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;
      const backward = builtinCompare(commits[headIndex]!.sha, commits[baseIndex]!.sha)!;
      const label = `${baseIndex + 1}..${headIndex + 1}`;

      expect(backward.status, label).toBe('behind');
      expect(backward.behindBy, label).toBe(forward.aheadBy);
      expect(backward.additions, label).toBe(forward.deletions);
      expect(backward.deletions, label).toBe(forward.additions);
      expect(backward.changedFiles, label).toBe(forward.changedFiles);

      const forwardStatus = new Map(forward.files.map((file) => [file.path, file.status]));
      for (const file of backward.files) {
        const other = forwardStatus.get(file.path);
        if (other === 'added') expect(file.status, `${label} ${file.path}`).toBe('removed');
        else if (other === 'removed') expect(file.status, `${label} ${file.path}`).toBe('added');
      }
    }
  });

  it('reports two identical points as identical, with nothing to show', () => {
    for (const commit of commits) {
      const compare = builtinCompare(commit.sha, commit.sha)!;
      expect(compare.status).toBe('identical');
      expect(compare.files).toEqual([]);
      expect(compare.additions).toBe(0);
      expect(compare.deletions).toBe(0);
    }
  });

  it('never marks a comparison of the whole demo as truncated', () => {
    const compare = builtinCompare(commits[0]!.sha, commits[15]!.sha)!;
    expect(compare.filesTruncated).toBe(false);
    expect(compare.commitsTruncated).toBe(false);
    expect(compare.aheadBy).toBe(15);
    expect(compare.commits).toHaveLength(15);
  });

  it('links nowhere, whichever pair is compared', () => {
    for (const [baseIndex, headIndex] of pairs) {
      const compare = builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)!;
      expect(compare.htmlUrl).toBeNull();
      expect(compare.base.htmlUrl).toBeNull();
      expect(compare.head.htmlUrl).toBeNull();
      for (const file of compare.files) expect(file.blobUrl).toBeNull();
    }
  });
});

/** Content at every commit, replayed from the per-commit patches. */
function contentByCommit(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const content = new Map<string, string[]>();

  for (const commit of commits) {
    for (const file of builtinCommitDetail(commit.sha)!.files) {
      if (file.status === 'removed') {
        content.delete(file.path);
        continue;
      }
      const from = file.previousPath ?? file.path;
      const before = content.get(from) ?? [];
      if (file.previousPath) content.delete(file.previousPath);
      content.set(file.path, file.patch === null ? before : applyPatch(before, file.patch));
    }
    out.set(
      commit.sha,
      new Map([...content].map(([path, lines]) => [path, lines.length ? `${lines.join('\n')}\n` : ''])),
    );
  }

  return out;
}

describe('the demo diff engine and the demo agree', () => {
  it('re-deriving a commit diff from the replayed content reproduces the patch', () => {
    const content = contentByCommit();

    for (let index = 1; index < commits.length; index += 1) {
      const previous = content.get(commits[index - 1]!.sha)!;
      const current = content.get(commits[index]!.sha)!;

      for (const file of builtinCommitDetail(commits[index]!.sha)!.files) {
        if (file.patch === null) continue;
        const before = toLines(previous.get(file.previousPath ?? file.path) ?? '');
        const after = toLines(current.get(file.path) ?? '');
        const recomputed = diffLines(before, after);
        expect(recomputed.patch, `${commits[index]!.shortSha} ${file.path}`).toBe(file.patch);
      }
    }
  });
});

describe('the demo never reaches GitHub', () => {
  it('touches no fetch and no GitHub client while serving every commit', async () => {
    /*
     * The strongest available statement about cost: exercise the whole demo —
     * metadata, every commit page, every detail, every tree, tags, path probes
     * and all 256 comparisons — with `fetch` replaced by a throw.
     */
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('the built-in demo must not fetch anything');
    }) as typeof fetch;

    try {
      const { builtinRepoMeta, builtinTags, builtinFirstCommitForPath } = await import(
        '@/lib/builtin/provider'
      );

      expect(builtinRepoMeta().dataSource).toBe('builtin');
      expect(builtinTags().length).toBeGreaterThan(0);
      expect(builtinCommitPage(1, 100).commits).toHaveLength(16);

      for (const commit of commits) {
        expect(builtinCommitDetail(commit.sha)).not.toBeNull();
        expect(builtinTree(commit.sha)).not.toBeNull();
      }
      for (const path of ['package.json', 'tsconfig.json', '.github/workflows/ci.yml']) {
        expect(builtinFirstCommitForPath(path)).toBeTruthy();
      }
      for (const [baseIndex, headIndex] of [
        [0, 15],
        [4, 13],
        [15, 0],
      ] as [number, number][]) {
        expect(builtinCompare(commits[baseIndex]!.sha, commits[headIndex]!.sha)).not.toBeNull();
      }
    } finally {
      globalThis.fetch = original;
    }

    expect(calls, 'the demo issued a network request').toEqual([]);
  });

  it('imports no GitHub client, service or adapter anywhere in its module graph', async () => {
    /*
     * A behavioural test can only prove that nothing fetched on the paths it
     * walked. This proves the code is not even reachable: the demo's transitive
     * imports are read from source, so a future edit that pulls the GitHub
     * client into the provider fails here rather than in production.
     */
    const { existsSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');

    const root = process.cwd();
    const seen = new Set<string>();
    const queue = ['src/lib/builtin/provider.ts'];

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);

      const source = readFileSync(path.join(root, file), 'utf8');
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith('node:')) continue;

        const resolved = specifier.startsWith('@/')
          ? path.join('src', specifier.slice(2))
          : specifier.startsWith('.')
            ? path.join(path.dirname(file), specifier)
            : null;
        // A bare package specifier is not part of this repository's graph.
        if (!resolved) continue;

        /*
         * Only files that exist are followed. The fixture's own content contains
         * import statements — it is a repository's source code, after all — and
         * those are text, not this module's dependencies. TypeScript already
         * guarantees every real import resolves, so nothing genuine is skipped.
         */
        const candidate = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
        if (existsSync(path.join(root, candidate))) queue.push(candidate);
      }
    }

    const forbidden = [...seen].filter((file) => /src\/lib\/github\//.test(file));
    expect(forbidden, 'the demo must not reach the GitHub layer').toEqual([]);
    // And the walk actually walked something, so it cannot pass vacuously.
    expect(seen.size).toBeGreaterThan(4);
  });
});

/** Guards the assumption the withheld-file assertions rest on. */
describe('the withheld files are the only ones without content', () => {
  it('has exactly two of them in the fixture', () => {
    const opaque = DEMO_COMMITS.flatMap((spec) =>
      spec.files.filter((op) => op.op === 'opaque' || op.op === 'opaqueMod').map((op) => op.path),
    );
    expect(new Set(opaque).size).toBe(2);
  });

  it('gives every other fixture entry real text', () => {
    for (const spec of DEMO_COMMITS) {
      for (const op of spec.files) {
        if (op.op === 'add' || op.op === 'mod') {
          expect(op.text.length, `${spec.sha.slice(0, 7)} ${op.path}`).toBeGreaterThan(0);
          expect(op.text.endsWith('\n'), `${op.path} must end in a newline`).toBe(true);
        }
      }
    }
  });
});

/** Keeps the file-change shape honest for the panels that render it. */
describe('the shape the interface receives', () => {
  it('never offers a blob URL, because there is no repository to open', () => {
    const files: FileChange[] = commits.flatMap((commit) => builtinCommitDetail(commit.sha)!.files);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) expect(file.blobUrl).toBeNull();
  });

  it('never marks a demo patch as truncated', () => {
    for (const commit of commits) {
      for (const file of builtinCommitDetail(commit.sha)!.files) {
        expect(file.patchTruncated).toBe(false);
      }
    }
  });
});
