import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  applyFileChanges,
  buildTree,
  defaultExpansion,
  fileSetFromTree,
  flattenTree,
  revertFileChanges,
  type FileSet,
} from '@/lib/tree/build';
import { classifyPath, isBinaryPath, isGeneratedPath } from '@/lib/tree/classify';
import { TreeProjector } from '@/lib/tree/projector';
import { commit, commits, detail, fileChange, sha, tree } from './factories';

const paths = (set: FileSet) => [...set.keys()].sort();

describe('fileSetFromTree', () => {
  it('keeps blobs with their sizes and ignores directory entries', () => {
    const set = fileSetFromTree(tree(sha('c'), [['src/a.ts', 120], ['README.md', 30]]));
    expect(paths(set)).toEqual(['README.md', 'src/a.ts']);
    expect(set.get('src/a.ts')?.size).toBe(120);
  });
});

describe('applyFileChanges', () => {
  const base: FileSet = new Map([
    ['README.md', { size: 10, sha: sha('r') }],
    ['src/old.ts', { size: 20, sha: sha('o') }],
    ['src/keep.ts', { size: 30, sha: sha('k') }],
  ]);

  it('adds a file', () => {
    const { next, changed } = applyFileChanges(base, [fileChange({ path: 'src/new.ts', status: 'added', additions: 12 })]);
    expect(next.has('src/new.ts')).toBe(true);
    expect(changed.get('src/new.ts')?.status).toBe('added');
  });

  it('removes a file and reports it as a ghost for one frame', () => {
    const { next, changed, removed } = applyFileChanges(base, [
      fileChange({ path: 'src/old.ts', status: 'removed', additions: 0, deletions: 20 }),
    ]);
    expect(next.has('src/old.ts')).toBe(false);
    expect(removed).toEqual(['src/old.ts']);
    expect(changed.get('src/old.ts')?.status).toBe('removed');
  });

  it('treats a rename as a removal plus an addition, keeping the old path', () => {
    const { next, changed, removed } = applyFileChanges(base, [
      fileChange({ path: 'src/new-name.ts', previousPath: 'src/old.ts', status: 'renamed' }),
    ]);
    expect(next.has('src/old.ts')).toBe(false);
    expect(next.has('src/new-name.ts')).toBe(true);
    expect(removed).toEqual(['src/old.ts']);
    expect(changed.get('src/new-name.ts')).toMatchObject({ status: 'renamed', previousPath: 'src/old.ts' });
  });

  it('marks a modification without changing the set membership', () => {
    const { next, changed } = applyFileChanges(base, [fileChange({ path: 'src/keep.ts', additions: 4, deletions: 2 })]);
    expect(paths(next)).toEqual(paths(base));
    expect(changed.get('src/keep.ts')).toMatchObject({ status: 'modified', additions: 4, deletions: 2 });
  });

  it('adopts a modified path the snapshot never saw, rather than losing it', () => {
    const { next } = applyFileChanges(base, [fileChange({ path: 'src/unseen.ts', status: 'modified' })]);
    expect(next.has('src/unseen.ts')).toBe(true);
  });

  it('leaves the input untouched', () => {
    applyFileChanges(base, [fileChange({ path: 'src/old.ts', status: 'removed' })]);
    expect(base.has('src/old.ts')).toBe(true);
  });
});

describe('revertFileChanges', () => {
  it('undoes an addition, a removal and a rename', () => {
    const before: FileSet = new Map([['a.ts', { size: 1, sha: sha('a') }]]);
    const changes = [
      fileChange({ path: 'b.ts', status: 'added' }),
      fileChange({ path: 'a.ts', status: 'removed' }),
      fileChange({ path: 'd.ts', previousPath: 'c.ts', status: 'renamed' }),
    ];
    const after = applyFileChanges(new Map([...before, ['c.ts', { size: 2, sha: sha('c') }]]), changes).next;
    const reverted = revertFileChanges(after, changes, before);
    expect(paths(reverted)).toEqual(['a.ts', 'c.ts']);
  });
});

describe('buildTree and flattenTree', () => {
  const files: FileSet = new Map([
    ['README.md', { size: 10, sha: null }],
    ['src/app/page.tsx', { size: 20, sha: null }],
    ['src/lib/util.ts', { size: 30, sha: null }],
    ['src/lib/deep/inner.ts', { size: 40, sha: null }],
  ]);

  it('counts files per directory', () => {
    const root = buildTree(files);
    const rows = flattenTree(root, { expanded: new Set(['src', 'src/lib']) }).rows;
    const src = rows.find((row) => row.path === 'src');
    const lib = rows.find((row) => row.path === 'src/lib');
    expect(src?.fileCount).toBe(3);
    expect(lib?.fileCount).toBe(2);
  });

  it('lists directories before files and sorts alphabetically', () => {
    const rows = flattenTree(buildTree(files), { expanded: new Set() }).rows;
    expect(rows.map((row) => row.name)).toEqual(['src', 'README.md']);
  });

  it('only descends into expanded directories', () => {
    const collapsed = flattenTree(buildTree(files), { expanded: new Set() }).rows;
    expect(collapsed.some((row) => row.path.startsWith('src/'))).toBe(false);

    const expanded = flattenTree(buildTree(files), { expanded: new Set(['src']) }).rows;
    expect(expanded.map((row) => row.path)).toContain('src/app');
    expect(expanded.map((row) => row.path)).not.toContain('src/app/page.tsx');
  });

  it('shows a deleted path one last time as a ghost row', () => {
    const root = buildTree(files, new Map(), ['src/lib/gone.ts']);
    const rows = flattenTree(root, { expanded: new Set(['src', 'src/lib']) }).rows;
    const ghost = rows.find((row) => row.path === 'src/lib/gone.ts');
    expect(ghost?.status).toBe('removed');
    // A ghost must not inflate the file count.
    expect(rows.find((row) => row.path === 'src/lib')?.fileCount).toBe(2);
  });

  it('rolls a change up to its ancestors', () => {
    const changes = new Map([['src/lib/util.ts', { status: 'modified' as const, previousPath: null, additions: 1, deletions: 0 }]]);
    const rows = flattenTree(buildTree(files, changes), { expanded: new Set(['src']) }).rows;
    expect(rows.find((row) => row.path === 'src')?.containsChange).toBe(true);
    expect(rows.find((row) => row.path === 'src/app')?.containsChange).toBe(false);
  });

  it('filters by substring and implicitly expands the matches', () => {
    const result = flattenTree(buildTree(files), { expanded: new Set(), filter: 'inner' });
    expect(result.rows.map((row) => row.path)).toEqual(['src', 'src/lib', 'src/lib/deep', 'src/lib/deep/inner.ts']);
  });

  it('reports truncation when the row budget is exceeded', () => {
    const many: FileSet = new Map(
      Array.from({ length: 200 }, (_, i) => [`file-${i}.ts`, { size: 1, sha: null }] as const),
    );
    const result = flattenTree(buildTree(many), { expanded: new Set(), maxRows: 50 });
    expect(result.rows).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.totalFiles).toBe(200);
  });

  it('handles an empty repository', () => {
    const result = flattenTree(buildTree(new Map()), { expanded: new Set() });
    expect(result.rows).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });
});

describe('defaultExpansion', () => {
  it('opens top-level directories only, so the shape is stable over time', () => {
    const files: FileSet = new Map(
      ['src/a/b/c.ts', 'src/d.ts', 'docs/e.md', 'README.md'].map((p) => [p, { size: 1, sha: null }]),
    );
    const expanded = defaultExpansion(buildTree(files));
    expect([...expanded].sort()).toEqual(['docs', 'src']);
  });

  it('stops before blowing past the row budget', () => {
    const files: FileSet = new Map(
      Array.from({ length: 30 }, (_, dir) =>
        Array.from({ length: 30 }, (_, file) => [`dir${dir}/file${file}.ts`, { size: 1, sha: null }] as const),
      )
        .flat()
        .map(([p, v]) => [p, v] as const),
    );
    const expanded = defaultExpansion(buildTree(files), 100);
    expect(expanded.size).toBeLessThan(30);
  });
});

describe('ancestorsOf', () => {
  it('lists every directory above a path', () => {
    expect(ancestorsOf('a/b/c/d.ts')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(ancestorsOf('root.ts')).toEqual([]);
  });
});

describe('classifyPath', () => {
  it.each([
    ['src/index.ts', 'TypeScript', 'source'],
    ['src/App.tsx', 'TypeScript', 'source'],
    ['main.py', 'Python', 'source'],
    ['styles/app.css', 'CSS', 'style'],
    ['README.md', 'Markdown', 'docs'],
    ['tsconfig.json', 'JSON', 'config'],
  ])('classifies %s', (path, language, kind) => {
    const facts = classifyPath(path);
    expect(facts.language).toBe(language);
    expect(facts.kind).toBe(kind);
  });

  it.each(['assets/logo.png', 'fonts/x.woff2', 'build/app.wasm', 'db.sqlite'])('treats %s as binary', (path) => {
    expect(isBinaryPath(path)).toBe(true);
    expect(classifyPath(path).language).toBeNull();
  });

  it.each([
    'package-lock.json',
    'yarn.lock',
    'node_modules/react/index.js',
    'dist/bundle.js',
    '.next/static/chunk.js',
    'coverage/lcov.info',
    'public/app.min.js',
    'src/app.js.map',
  ])('treats %s as generated', (path) => {
    expect(isGeneratedPath(path)).toBe(true);
    expect(classifyPath(path).kind).toBe('generated');
  });

  it.each(['tests/unit.test.ts', 'src/__tests__/thing.ts', 'e2e/flow.spec.ts'])('treats %s as a test', (path) => {
    expect(classifyPath(path).kind).toBe('test');
  });

  it('does not mistake a directory called "distribute" for build output', () => {
    expect(isGeneratedPath('src/distribute/index.ts')).toBe(false);
  });
});

describe('TreeProjector', () => {
  it('returns an exact projection at a commit that has a tree snapshot', () => {
    const projector = new TreeProjector();
    const range = commits(3);
    projector.setCommits(range);
    projector.addSnapshot(range[2]!.sha, tree(range[2]!.sha, ['a.ts', 'b.ts']));

    const projection = projector.project(2);
    expect(projection.fidelity).toBe('exact');
    expect(paths(projection.files)).toEqual(['a.ts', 'b.ts']);
    expect(projection.missingCommits).toBe(0);
  });

  it('derives a later commit from an earlier snapshot plus every diff', () => {
    const projector = new TreeProjector();
    const range = commits(3);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    projector.addDetail(range[1]!.sha, detail(range[1]!.sha, [fileChange({ path: 'b.ts', status: 'added' })]));
    projector.addDetail(range[2]!.sha, detail(range[2]!.sha, [fileChange({ path: 'a.ts', status: 'removed' })]));

    const projection = projector.project(2);
    expect(projection.fidelity).toBe('derived');
    expect(paths(projection.files)).toEqual(['b.ts']);
    expect(projection.ghosts).toEqual(['a.ts']);
  });

  it('reports a partial projection when diffs in between are missing', () => {
    const projector = new TreeProjector();
    const range = commits(4);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    projector.addDetail(range[3]!.sha, detail(range[3]!.sha, [fileChange({ path: 'd.ts', status: 'added' })]));

    const projection = projector.project(3);
    expect(projection.fidelity).toBe('partial');
    expect(projection.missingCommits).toBe(2);
    expect(projection.sourceIndex).toBe(0);
  });

  it('prefers a nearer snapshot over replaying diffs', () => {
    const projector = new TreeProjector();
    const range = commits(5);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['old.ts']));
    projector.addSnapshot(range[4]!.sha, tree(range[4]!.sha, ['new.ts']));

    const projection = projector.project(4);
    expect(projection.sourceIndex).toBe(4);
    expect(paths(projection.files)).toEqual(['new.ts']);
  });

  it('gives the same answer whether stepped through or jumped to', () => {
    const projector = new TreeProjector();
    const range = commits(6);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    for (let i = 1; i < 6; i += 1) {
      projector.addDetail(range[i]!.sha, detail(range[i]!.sha, [fileChange({ path: `f${i}.ts`, status: 'added' })]));
    }

    const jumped = paths(projector.project(5).files);

    const stepped = new TreeProjector();
    stepped.setCommits(range);
    stepped.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    for (let i = 1; i < 6; i += 1) {
      stepped.addDetail(range[i]!.sha, detail(range[i]!.sha, [fileChange({ path: `f${i}.ts`, status: 'added' })]));
    }
    for (let i = 0; i <= 5; i += 1) stepped.project(i);

    expect(paths(stepped.project(5).files)).toEqual(jumped);
  });

  it('re-projects once a previously missing diff arrives', () => {
    const projector = new TreeProjector();
    const range = commits(3);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['a.ts']));
    expect(projector.project(2).fidelity).toBe('partial');

    projector.addDetail(range[1]!.sha, detail(range[1]!.sha, [fileChange({ path: 'b.ts', status: 'added' })]));
    projector.addDetail(range[2]!.sha, detail(range[2]!.sha, [fileChange({ path: 'c.ts', status: 'added' })]));
    const projection = projector.project(2);
    expect(projection.fidelity).toBe('derived');
    expect(paths(projection.files)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('handles a repository with exactly one commit', () => {
    const projector = new TreeProjector();
    const only = commit({ index: 0, parents: [] });
    projector.setCommits([only]);
    projector.addSnapshot(only.sha, tree(only.sha, ['README.md']));
    const projection = projector.project(0);
    expect(projection.fidelity).toBe('exact');
    expect(paths(projection.files)).toEqual(['README.md']);
  });

  it('returns an empty projection when nothing is loaded', () => {
    const projection = new TreeProjector().project(0);
    expect(projection.files.size).toBe(0);
    expect(projection.sourceIndex).toBe(-1);
  });

  it('clamps an out-of-range index instead of throwing', () => {
    const projector = new TreeProjector();
    const range = commits(2);
    projector.setCommits(range);
    projector.addSnapshot(range[1]!.sha, tree(range[1]!.sha, ['a.ts']));
    expect(projector.project(99).commitIndex).toBe(1);
    expect(projector.project(-5).commitIndex).toBe(0);
  });

  it('forgets everything when cleared, so a repository switch cannot leak data', () => {
    const projector = new TreeProjector();
    const range = commits(2);
    projector.setCommits(range);
    projector.addSnapshot(range[0]!.sha, tree(range[0]!.sha, ['leak.ts']));
    projector.clear();
    expect(projector.project(0).files.size).toBe(0);
    expect(projector.snapshotIndices).toEqual([]);
  });
});
