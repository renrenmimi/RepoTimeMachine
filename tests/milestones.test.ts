import { describe, expect, it } from 'vitest';
import { detectMilestones, firstAppearance, type Milestone } from '@/lib/milestones/detect';
import { SIGNATURE_BY_KIND } from '@/lib/milestones/signatures';
import type { Commit, FileChange } from '@/lib/domain/types';
import { commit, commits, fileChange, sha } from './factories';

const added = (path: string, additions = 10): FileChange =>
  fileChange({ path, status: 'added', additions, deletions: 0 });

const kinds = (milestones: Milestone[]) => milestones.map((m) => m.kind);

const detect = (
  range: Commit[],
  changes: Record<number, FileChange[]> = {},
  extra: Partial<Parameters<typeof detectMilestones>[0]> = {},
) =>
  detectMilestones({
    commits: range,
    tags: [],
    changesBySha: new Map(Object.entries(changes).map(([index, files]) => [range[Number(index)]!.sha, files])),
    snapshots: [],
    ...extra,
  });

describe('metadata rules', () => {
  it('marks the parentless commit as the initial commit', () => {
    const found = detect(commits(3)).filter((m) => m.kind === 'initial-commit');
    expect(found).toHaveLength(1);
    expect(found[0]?.commitIndex).toBe(0);
    expect(found[0]?.rule).toContain('no parent');
    expect(found[0]?.confidence).toBe('exact');
  });

  it('marks a commit with two parents as a merge and counts them', () => {
    const range = commits(3);
    range[2] = { ...range[2]!, parents: [sha('commit-1'), sha('side-branch')] };
    const merge = detect(range).find((m) => m.kind === 'merge-commit');
    expect(merge?.commitIndex).toBe(2);
    expect(merge?.evidence).toContain('2 parents');
  });

  it('marks a Conventional Commits breaking change', () => {
    const range = commits(2);
    range[1] = { ...range[1]!, subject: 'feat(api)!: drop the v1 endpoints' };
    const breaking = detect(range).find((m) => m.kind === 'breaking-change');
    expect(breaking?.commitIndex).toBe(1);
    // The rule must not claim to understand intent.
    expect(breaking?.evidence).toContain('author labelled');
  });

  it('marks a BREAKING CHANGE footer in the body', () => {
    const range = commits(2);
    range[1] = { ...range[1]!, body: 'Some detail.\n\nBREAKING CHANGE: the config format moved.' };
    expect(kinds(detect(range))).toContain('breaking-change');
  });

  it('does not mistake an exclamation mark elsewhere for a breaking marker', () => {
    const range = commits(2);
    range[1] = { ...range[1]!, subject: 'fix: it works now!' };
    expect(kinds(detect(range))).not.toContain('breaking-change');
  });

  it('marks a revert', () => {
    const range = commits(2);
    range[1] = { ...range[1]!, subject: 'Revert "feat: the thing"' };
    expect(kinds(detect(range))).toContain('revert');
  });

  it('marks a tagged commit and names the tag', () => {
    const range = commits(3);
    const tagged = detectMilestones({
      commits: range,
      tags: [{ name: 'v1.0.0', sha: range[1]!.sha }],
      changesBySha: new Map(),
      snapshots: [],
    }).find((m) => m.kind === 'release-tag');
    expect(tagged?.commitIndex).toBe(1);
    expect(tagged?.label).toBe('Tagged v1.0.0');
  });

  it('ignores a tag pointing outside the loaded range', () => {
    const found = detectMilestones({
      commits: commits(3),
      tags: [{ name: 'v0.1.0', sha: sha('not-loaded') }],
      changesBySha: new Map(),
      snapshots: [],
    });
    expect(kinds(found)).not.toContain('release-tag');
  });
});

describe('path rules', () => {
  it('fires once, on the commit that first adds the file', () => {
    const range = commits(4);
    const found = detect(range, {
      1: [added('package.json')],
      3: [added('packages/web/package.json')],
    }).filter((m) => m.kind === 'first-manifest');
    expect(found).toHaveLength(1);
    expect(found[0]?.commitIndex).toBe(1);
    expect(found[0]?.evidence).toContain('package.json');
  });

  it.each([
    ['first-readme', 'README.md'],
    ['first-manifest', 'pyproject.toml'],
    ['first-lockfile', 'pnpm-lock.yaml'],
    ['framework-config', 'next.config.ts'],
    ['first-typescript', 'tsconfig.json'],
    ['first-test', 'tests/unit.test.ts'],
    ['first-ci', '.github/workflows/ci.yml'],
    ['first-deploy-config', 'Dockerfile'],
    ['first-license', 'LICENSE'],
  ])('detects %s from %s', (kind, path) => {
    const range = commits(2);
    expect(kinds(detect(range, { 1: [added(path)] }))).toContain(kind);
  });

  it('does not treat a nested readme as the repository README', () => {
    const range = commits(2);
    expect(kinds(detect(range, { 1: [added('docs/readme.md')] }))).not.toContain('first-readme');
  });

  it('does not treat a deeply nested manifest as the project manifest', () => {
    const range = commits(2);
    expect(kinds(detect(range, { 1: [added('vendor/a/b/package.json')] }))).not.toContain('first-manifest');
  });

  it('counts a rename as an appearance, because the path is new here', () => {
    const range = commits(2);
    const changes = { 1: [fileChange({ path: 'README.md', previousPath: 'readme.txt', status: 'renamed' })] };
    expect(kinds(detect(range, changes))).toContain('first-readme');
  });

  it('publishes the rule text alongside every path milestone', () => {
    const range = commits(2);
    const milestone = detect(range, { 1: [added('README.md')] }).find((m) => m.kind === 'first-readme');
    expect(milestone?.rule).toBe(SIGNATURE_BY_KIND.get('first-readme')?.rule);
  });
});

describe('size and shape rules', () => {
  const range = commits(10);

  it('flags a commit far larger than the median once there are enough samples', () => {
    const changes: Record<number, FileChange[]> = {};
    for (let i = 0; i < 10; i += 1) {
      changes[i] = [fileChange({ path: `src/f${i}.ts`, additions: 10, deletions: 5 })];
    }
    changes[6] = [fileChange({ path: 'src/big.ts', additions: 4000, deletions: 200 })];

    const large = detect(range, changes).filter((m) => m.kind === 'large-change');
    expect(large).toHaveLength(1);
    expect(large[0]?.commitIndex).toBe(6);
    expect(large[0]?.evidence).toContain('4,200 changed lines');
  });

  it('stays quiet when there are too few samples to compare against', () => {
    const small = commits(3);
    const changes = { 0: [fileChange({ path: 'a.ts', additions: 9000, deletions: 0 })] };
    expect(kinds(detect(small, changes))).not.toContain('large-change');
  });

  it('does not flag a busy but uniform history', () => {
    const changes: Record<number, FileChange[]> = {};
    for (let i = 0; i < 10; i += 1) {
      changes[i] = [fileChange({ path: `src/f${i}.ts`, additions: 500, deletions: 400 })];
    }
    expect(kinds(detect(range, changes))).not.toContain('large-change');
  });

  it('flags a commit that introduces several top-level directories at once', () => {
    const changes = {
      2: [added('src/a.ts'), added('tests/b.ts'), added('docs/c.md'), added('scripts/d.sh')],
    };
    const structural = detect(range, changes).find((m) => m.kind === 'structural-change');
    expect(structural?.commitIndex).toBe(2);
    expect(structural?.evidence).toContain('src/');
  });

  it('does not flag many files inside one directory as structural', () => {
    const changes = { 2: [added('src/a.ts'), added('src/b.ts'), added('src/c.ts'), added('src/d.ts')] };
    expect(kinds(detect(range, changes))).not.toContain('structural-change');
  });

  it('reports a language the first time a file with its extension is added', () => {
    const changes = { 1: [added('src/a.ts')], 4: [added('server/main.go')] };
    const languages = detect(range, changes).filter((m) => m.kind === 'new-language');
    expect(languages.map((m) => m.label)).toEqual(['TypeScript appears', 'Go appears']);
    expect(languages[1]?.commitIndex).toBe(4);
  });

  it('does not report data formats as languages', () => {
    const changes = { 1: [added('data.json'), added('config.yml'), added('notes.md')] };
    expect(kinds(detect(range, changes))).not.toContain('new-language');
  });

  it('does not report a language that already existed at the start of the range', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map([[range[3]!.sha, [added('src/other.ts')]]]),
      snapshots: [{ commitIndex: 0, paths: new Set(['src/existing.ts']) }],
    });
    expect(kinds(found)).not.toContain('new-language');
  });
});

describe('evidence quality', () => {
  const range = commits(6);

  it('prefers a diff we hold over a probe result', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map([[range[1]!.sha, [added('README.md')]]]),
      snapshots: [],
      probes: new Map([['README.md', range[4]!.sha]]),
    }).find((m) => m.kind === 'first-readme');
    expect(found?.confidence).toBe('exact');
    expect(found?.commitIndex).toBe(1);
  });

  it('uses a probe result when no diff is available', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map(),
      snapshots: [],
      probes: new Map([['README.md', range[3]!.sha]]),
    }).find((m) => m.kind === 'first-readme');
    expect(found?.confidence).toBe('probed');
    expect(found?.commitIndex).toBe(3);
  });

  it('ignores a probe result pointing outside the loaded range', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map(),
      snapshots: [],
      probes: new Map([['README.md', sha('elsewhere')]]),
    });
    expect(kinds(found)).not.toContain('first-readme');
  });

  it('falls back to a commit range bracketed by two snapshots', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map(),
      snapshots: [
        { commitIndex: 0, paths: new Set(['src/a.ts']) },
        { commitIndex: 4, paths: new Set(['src/a.ts', 'package.json']) },
      ],
    }).find((m) => m.kind === 'first-manifest');

    expect(found?.confidence).toBe('window');
    expect(found?.window).toEqual({ fromIndex: 1, toIndex: 4 });
    expect(found?.evidence).toContain('somewhere in between');
  });

  it('says nothing when the file already existed before the loaded range began', () => {
    const found = detectMilestones({
      commits: range,
      tags: [],
      changesBySha: new Map(),
      snapshots: [
        { commitIndex: 0, paths: new Set(['package.json']) },
        { commitIndex: 4, paths: new Set(['package.json']) },
      ],
    });
    expect(kinds(found)).not.toContain('first-manifest');
  });
});

describe('firstAppearance', () => {
  const range = commits(4);
  const test = (path: string) => path === 'target.ts';

  it('returns null when there is no evidence at all', () => {
    expect(firstAppearance(test, range, new Map(), [], new Map())).toBeNull();
  });

  it('picks the earliest of two competing sources', () => {
    const found = firstAppearance(
      test,
      range,
      new Map([[range[3]!.sha, [added('target.ts')]]]),
      [],
      new Map([['target.ts', range[1]!.sha]]),
    );
    expect(found?.commitIndex).toBe(1);
    expect(found?.confidence).toBe('probed');
  });
});

describe('output shape', () => {
  it('is sorted oldest first and has stable identifiers', () => {
    const range = commits(5);
    range[3] = { ...range[3]!, parents: [sha('a'), sha('b')] };
    const found = detect(range, { 2: [added('README.md')], 4: [added('tsconfig.json')] });

    const indices = found.map((m) => m.commitIndex);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    expect(new Set(found.map((m) => m.id)).size).toBe(found.length);
  });

  it('produces nothing for an empty range', () => {
    expect(detect([])).toEqual([]);
  });

  it('handles a single-commit repository', () => {
    const only = [commit({ index: 0, parents: [] })];
    const found = detect(only, { 0: [added('README.md'), added('package.json')] });
    expect(kinds(found)).toEqual(expect.arrayContaining(['initial-commit', 'first-readme', 'first-manifest']));
    expect(found.every((m) => m.commitIndex === 0)).toBe(true);
  });
});
