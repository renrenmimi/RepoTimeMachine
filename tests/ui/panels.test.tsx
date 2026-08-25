/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitPanel } from '@/components/CommitPanel';
import { RepoInput } from '@/components/RepoInput';
import { TreePanel } from '@/components/TreePanel';
import type { Milestone } from '@/lib/milestones/detect';
import type { Projection } from '@/lib/tree/projector';
import type { ChangeMap, FileSet } from '@/lib/tree/build';
import { commit, commits, detail, fileChange, sha } from '../factories';

const range = commits(5);

// -------------------------------------------------------------- CommitPanel ---

const baseCommitProps = {
  previous: range[2]!,
  detailPending: false,
  milestones: [] as Milestone[],
  playing: false,
};

describe('CommitPanel', () => {
  it('shows the subject, author, timestamp and a link to GitHub', () => {
    const target = commit({ index: 3, subject: 'fix: stop the leak' });
    render(<CommitPanel {...baseCommitProps} commit={target} detail={null} />);

    expect(screen.getByRole('heading', { level: 3, name: 'fix: stop the leak' })).toBeInTheDocument();
    expect(screen.getByText('Fixture Author')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: new RegExp(target.shortSha) });
    expect(link).toHaveAttribute('href', target.htmlUrl);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders a hostile commit subject as text, not markup', () => {
    const hostile = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
    render(<CommitPanel {...baseCommitProps} commit={commit({ index: 3, subject: hostile })} detail={null} />);

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(hostile);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders a hostile author name as text', () => {
    const target = commit({ index: 3 });
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={{ ...target, author: { ...target.author, name: '<b>not bold</b>' } }}
        detail={null}
      />,
    );
    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('collapses a long commit body behind a toggle', async () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    render(<CommitPanel {...baseCommitProps} commit={commit({ index: 3, body })} detail={null} />);

    expect(screen.queryByText(/line 19/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show all 20 lines/ }));
    expect(screen.getByText(/line 19/)).toBeInTheDocument();
  });

  it('says the diff has not loaded rather than showing an empty list', () => {
    render(<CommitPanel {...baseCommitProps} commit={range[3]!} detail={null} detailPending />);
    expect(screen.getByText(/Loading this commit/)).toBeInTheDocument();
  });

  it('lists changed files with their line counts', () => {
    const target = range[3]!;
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [
          fileChange({ path: 'src/app/page.tsx', status: 'added', additions: 42, deletions: 0 }),
          fileChange({ path: 'src/old.ts', status: 'removed', additions: 0, deletions: 17 }),
        ])}
      />,
    );
    expect(screen.getByText('page.tsx')).toBeInTheDocument();
    // Once in the file row and once in the commit total.
    expect(screen.getAllByText('+42')).toHaveLength(2);
    expect(screen.getAllByText('−17')).toHaveLength(2);
  });

  it('shows where a renamed file came from', () => {
    const target = range[3]!;
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [
          fileChange({ path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' }),
        ])}
      />,
    );
    expect(screen.getByText(/renamed from/)).toBeInTheDocument();
    expect(screen.getByText('src/old.ts')).toBeInTheDocument();
  });

  it('expands a patch on demand and colours the lines', async () => {
    const target = range[3]!;
    const patch = '@@ -1,2 +1,3 @@\n context\n-removed line\n+added line';
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [fileChange({ path: 'a.ts', patch, additions: 1, deletions: 1 })])}
      />,
    );

    const toggle = screen.getByRole('button', { name: /a\.ts/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const pre = screen.getByLabelText('Diff for a.ts');
    expect(pre).toHaveTextContent('+added line');
    expect(pre.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(pre.querySelectorAll('[data-kind="del"]')).toHaveLength(1);
    expect(pre.querySelectorAll('[data-kind="hunk"]')).toHaveLength(1);
  });

  it('renders hostile patch content as text', async () => {
    const target = range[3]!;
    const patch = '@@ -1 +1 @@\n+<script>alert(1)</script>';
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [fileChange({ path: 'x.html', patch, additions: 1 })])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /x\.html/ }));
    expect(screen.getByLabelText('Diff for x.html')).toHaveTextContent('<script>alert(1)</script>');
    expect(document.querySelector('script')).toBeNull();
  });

  it('explains a binary file instead of showing a blank diff', async () => {
    const target = range[3]!;
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [
          fileChange({
            path: 'assets/logo.png',
            status: 'added',
            patch: null,
            patchOmittedReason: 'binary',
            additions: 0,
            deletions: 0,
            blobUrl: 'https://github.com/o/r/blob/main/assets/logo.png',
          }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /logo\.png/ }));
    expect(screen.getByText(/does not provide a text diff/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View this file on GitHub/ })).toBeInTheDocument();
  });

  it('explains an oversized diff', async () => {
    const target = range[3]!;
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [
          fileChange({ path: 'huge.json', patch: null, patchOmittedReason: 'too-large', additions: 90_000 }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /huge\.json/ }));
    expect(screen.getByText(/too large/)).toBeInTheDocument();
  });

  it('says when a patch was cut short', async () => {
    const target = range[3]!;
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={detail(target.sha, [
          fileChange({ path: 'b.ts', patch: '@@ -1 +1 @@\n+x', patchTruncated: true, additions: 1 }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /b\.ts/ }));
    expect(screen.getByText(/cut short/)).toBeInTheDocument();
  });

  it('warns that GitHub caps the file list at 300', () => {
    const target = range[3]!;
    const files = Array.from({ length: 300 }, (_, i) => fileChange({ path: `f${i}.ts` }));
    render(
      <CommitPanel
        {...baseCommitProps}
        commit={target}
        detail={{ ...detail(target.sha, files), filesTruncated: true }}
      />,
    );
    expect(screen.getByText(/at most 300 files per commit/)).toBeInTheDocument();
  });

  it('pages through a very long file list instead of rendering it all', async () => {
    const target = range[3]!;
    const files = Array.from({ length: 150 }, (_, i) => fileChange({ path: `dir/f${i}.ts` }));
    render(<CommitPanel {...baseCommitProps} commit={target} detail={detail(target.sha, files)} />);

    expect(screen.queryByText('f149.ts')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show \d+ more files/ }));
    expect(screen.getByText('f149.ts')).toBeInTheDocument();
  });

  it('states the rule and the evidence for every milestone on this commit', () => {
    const target = range[3]!;
    const milestone: Milestone = {
      id: 'first-manifest:x',
      sha: target.sha,
      commitIndex: 3,
      kind: 'first-manifest',
      label: 'First package manifest',
      rule: 'A dependency manifest appears.',
      evidence: 'package.json is added here.',
      confidence: 'window',
      window: { fromIndex: 1, toIndex: 3 },
    };
    render(<CommitPanel {...baseCommitProps} commit={target} detail={null} milestones={[milestone]} />);

    expect(screen.getByText('First package manifest')).toBeInTheDocument();
    expect(screen.getByText('package.json is added here.')).toBeInTheDocument();
    expect(screen.getByText(/Rule: A dependency manifest appears/)).toBeInTheDocument();
    expect(screen.getByText(/narrowed to commits 2–4/)).toBeInTheDocument();
  });

  it('handles having no commit at all', () => {
    render(<CommitPanel {...baseCommitProps} commit={null} detail={null} />);
    expect(screen.getByText('No commit selected.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- TreePanel ---

function projection(
  files: [string, number | null][],
  changes: ChangeMap = new Map(),
  ghosts: string[] = [],
  overrides: Partial<Projection> = {},
): Projection {
  const set: FileSet = new Map(files.map(([path, size]) => [path, { size, sha: sha(path) }]));
  return {
    commitIndex: 3,
    files: set,
    changes,
    ghosts,
    fidelity: 'exact',
    missingCommits: 0,
    sourceIndex: 3,
    sourceTruncated: false,
    ...overrides,
  };
}

const treeProps = {
  commits: range,
  currentIndex: 3,
  details: new Map(),
  loading: false,
  version: 1,
  onSeek: vi.fn(),
};

describe('TreePanel', () => {
  it('shows top-level folders open and the file count', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([
          ['src/app/page.tsx', 100],
          ['src/lib/util.ts', 200],
          ['README.md', 50],
        ])}
      />,
    );
    expect(screen.getByText('3 files')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
    // A second level stays closed until asked for.
    expect(screen.queryByText('page.tsx')).not.toBeInTheDocument();
  });

  it('expands and collapses a folder on click', async () => {
    render(<TreePanel {...treeProps} projection={projection([['src/app/page.tsx', 100]])} />);
    await userEvent.click(screen.getByRole('button', { name: /app/ }));
    expect(screen.getByText('page.tsx')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /app/ }));
    expect(screen.queryByText('page.tsx')).not.toBeInTheDocument();
  });

  it('reveals the folders a commit touched, without being asked', () => {
    const changes: ChangeMap = new Map([
      ['src/deep/nested/changed.ts', { status: 'added', previousPath: null, additions: 3, deletions: 0 }],
    ]);
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['src/deep/nested/changed.ts', 10], ['src/other/quiet.ts', 10]], changes)}
      />,
    );
    expect(screen.getByText('changed.ts')).toBeInTheDocument();
    expect(screen.queryByText('quiet.ts')).not.toBeInTheDocument();
  });

  it('marks added, modified and renamed files, for sighted and screen-reader users', () => {
    const changes: ChangeMap = new Map([
      ['a.ts', { status: 'added', previousPath: null, additions: 5, deletions: 0 }],
      ['b.ts', { status: 'modified', previousPath: null, additions: 1, deletions: 1 }],
      ['c.ts', { status: 'renamed', previousPath: 'old.ts', additions: 0, deletions: 0 }],
    ]);
    const { container } = render(
      <TreePanel {...treeProps} projection={projection([['a.ts', 1], ['b.ts', 1], ['c.ts', 1]], changes)} />,
    );
    expect(container.querySelectorAll('[data-status="added"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-status="modified"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-status="renamed"]').length).toBeGreaterThan(0);
    expect(screen.getByText('added in this commit')).toBeInTheDocument();
    expect(screen.getByText('modified in this commit')).toBeInTheDocument();
  });

  it('shows a deleted file one last time, struck through', () => {
    const changes: ChangeMap = new Map([
      ['gone.ts', { status: 'removed', previousPath: null, additions: 0, deletions: 12 }],
    ]);
    const { container } = render(
      <TreePanel {...treeProps} projection={projection([['stays.ts', 1]], changes, ['gone.ts'])} />,
    );
    expect(screen.getByText('gone.ts')).toBeInTheDocument();
    expect(container.querySelector('[data-status="removed"]')).not.toBeNull();
    expect(screen.getByText('deleted in this commit')).toBeInTheDocument();
    // The ghost must not be counted as a live file.
    expect(screen.getByText('1 file')).toBeInTheDocument();
  });

  it('labels binary and generated files', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['logo.png', 900], ['package-lock.json', 4000], ['src.ts', 10]])}
      />,
    );
    expect(screen.getByText('binary')).toBeInTheDocument();
    expect(screen.getByText('generated')).toBeInTheDocument();
  });

  it('filters paths and shows a message when nothing matches', async () => {
    render(<TreePanel {...treeProps} projection={projection([['src/app/page.tsx', 1], ['README.md', 1]])} />);
    const filter = screen.getByLabelText('Filter file paths in the tree');

    await userEvent.type(filter, 'page');
    expect(screen.getByText('page.tsx')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    await userEvent.clear(filter);
    await userEvent.type(filter, 'zzzz');
    expect(screen.getByText(/No paths match/)).toBeInTheDocument();
  });

  it('says the tree is exact when it came from a snapshot at this commit', () => {
    render(<TreePanel {...treeProps} projection={projection([['a.ts', 1]])} />);
    expect(screen.getByTitle(/read at this exact commit/)).toHaveTextContent('exact');
  });

  it('says how many diffs are missing when the tree is only approximate', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['a.ts', 1]], new Map(), [], {
          fidelity: 'partial',
          missingCommits: 7,
          sourceIndex: 0,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /7 gaps/ })).toBeInTheDocument();
  });

  it('reports a rebuilt tree differently from an exact one', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['a.ts', 1]], new Map(), [], { fidelity: 'derived', sourceIndex: 1 })}
      />,
    );
    expect(screen.getByTitle(/plus every diff since/)).toHaveTextContent('rebuilt');
  });

  it('shows the most recent change to a file when one is known', async () => {
    const target = range[2]!;
    const details = new Map([
      [target.sha, detail(target.sha, [fileChange({ path: 'src/a.ts', additions: 9, deletions: 4 })])],
    ]);
    render(
      <TreePanel
        {...treeProps}
        details={details}
        projection={projection([['src/a.ts', 100]])}
      />,
    );
    // `src` is a top-level folder, so it is already open.
    await userEvent.click(screen.getByRole('button', { name: /a\.ts/ }));

    expect(screen.getByText(/last change at or before this point/)).toBeInTheDocument();
    expect(screen.getByText('+9')).toBeInTheDocument();
    expect(screen.getByText('−4')).toBeInTheDocument();
  });

  it('says so when no change to the selected file is known', async () => {
    render(<TreePanel {...treeProps} projection={projection([['a.ts', 100]])} />);
    await userEvent.click(screen.getByRole('button', { name: /a\.ts/ }));
    expect(screen.getByText(/No change found in the 0 commit diffs/)).toBeInTheDocument();
  });

  it('renders a hostile file name as text', () => {
    // No slash: a real `/` would legitimately split into a directory.
    const hostile = '<img src=x onerror=alert(1)>.ts';
    const { container } = render(<TreePanel {...treeProps} projection={projection([[hostile, 1]])} />);
    expect(container.textContent).toContain(hostile);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('handles a point in history with no files yet', () => {
    render(<TreePanel {...treeProps} projection={projection([])} />);
    expect(screen.getByText('No files at this point in the history.')).toBeInTheDocument();
    expect(screen.getByText('0 files')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- RepoInput ---

describe('RepoInput', () => {
  it('submits a valid reference', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'renrenmimi/DrillLab');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'renrenmimi/DrillLab' }));
  });

  it('accepts a pasted GitHub URL', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'https://github.com/renrenmimi/PetNote/tree/main');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'renrenmimi/PetNote' }));
  });

  it('refuses a non-GitHub host and explains why', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'https://gitlab.com/a/b');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Only github.com repositories/);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses an empty submission', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter a repository/);
  });

  it('clears the error as soon as the visitor edits the field', async () => {
    render(<RepoInput current={null} busy={false} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'a');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows whatever repository is loaded', () => {
    render(
      <RepoInput
        current={{ owner: 'renrenmimi', repo: 'DataData', slug: 'renrenmimi/DataData' }}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('renrenmimi/DataData');
  });

  it('reverts an edit on Escape', async () => {
    render(
      <RepoInput current={{ owner: 'a', repo: 'b', slug: 'a/b' }} busy={false} onSubmit={vi.fn()} />,
    );
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'typing');
    expect(input).toHaveValue('typing');
    await userEvent.type(input, '{Escape}');
    expect(input).toHaveValue('a/b');
  });

  it('shows a busy state while loading', () => {
    render(<RepoInput current={null} busy onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Loading' })).toBeDisabled();
  });
});
