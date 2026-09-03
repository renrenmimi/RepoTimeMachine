/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreePanel } from '@/components/TreePanel';
import type { Projection } from '@/lib/tree/projector';
import type { ChangeMap, FileSet } from '@/lib/tree/build';
import { commits, detail, fileChange, sha } from '../factories';

const range = commits(5);

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
  onOpenDiff: vi.fn(),
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
    expect(screen.getByText(/No path matches/)).toBeInTheDocument();
    // A no-match is not an empty repository, and it is recoverable.
    expect(screen.getByText(/not file contents/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the filter' }));
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('says the tree was read here when it came from a snapshot at this commit', () => {
    render(<TreePanel {...treeProps} projection={projection([['a.ts', 1]])} />);
    expect(screen.getByText('Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/read at this exact commit/)).toBeInTheDocument();
  });

  it('reports a rebuilt tree differently, and says there are no gaps', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['a.ts', 1]], new Map(), [], { fidelity: 'derived', sourceIndex: 1 })}
      />,
    );
    expect(screen.getByText('Reconstructed')).toBeInTheDocument();
    expect(screen.getByText(/plus every diff since. No gaps./)).toBeInTheDocument();
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
    expect(screen.getByText('Approximate')).toBeInTheDocument();
    expect(screen.getByText(/7 commit diffs in between have not loaded/)).toBeInTheDocument();
    // And a way to get to the snapshot it was built from.
    expect(screen.getByRole('button', { name: /Go to commit 1/ })).toBeInTheDocument();
  });

  it('says a truncated snapshot is missing paths', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['a.ts', 1]], new Map(), [], { sourceTruncated: true })}
      />,
    );
    expect(screen.getByText(/truncated it because the repository is very large/)).toBeInTheDocument();
  });

  it('says nothing has been read when no tree is available at all', () => {
    render(
      <TreePanel {...treeProps} projection={projection([], new Map(), [], { sourceIndex: -1 })} />,
    );
    expect(screen.getByText('No snapshot')).toBeInTheDocument();
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

    expect(screen.getByText(/Last change at or before this point/)).toBeInTheDocument();
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
    expect(screen.getByText('No files at this point in the history')).toBeInTheDocument();
    expect(screen.getByText('0 files')).toBeInTheDocument();
  });
});


describe('TreePanel opening a diff', () => {
  const changes: ChangeMap = new Map([
    ['src/changed.ts', { status: 'modified', previousPath: null, additions: 2, deletions: 1 }],
  ]);

  it('offers a diff on a file this commit touched', async () => {
    const onOpenDiff = vi.fn();
    render(
      <TreePanel
        {...treeProps}
        onOpenDiff={onOpenDiff}
        projection={projection([['src/changed.ts', 10], ['src/quiet.ts', 10]], changes)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open the diff for src/changed.ts' }));
    expect(onOpenDiff).toHaveBeenCalledWith('src/changed.ts');
  });

  it('offers no diff on a file this commit did not touch', () => {
    render(
      <TreePanel
        {...treeProps}
        projection={projection([['src/changed.ts', 10], ['src/quiet.ts', 10]], changes)}
      />,
    );
    // Inventing a diff for an unchanged file is the one thing this must not do.
    expect(screen.queryByRole('button', { name: 'Open the diff for src/quiet.ts' })).not.toBeInTheDocument();
  });

  it('offers the diff from the inspector too, for a changed file', async () => {
    const onOpenDiff = vi.fn();
    render(
      <TreePanel
        {...treeProps}
        onOpenDiff={onOpenDiff}
        projection={projection([['src/changed.ts', 10]], changes)}
      />,
    );

    // The row itself, not the trailing Diff shortcut also named for the path.
    await userEvent.click(screen.getByRole('button', { name: /modified in this commit/ }));
    await userEvent.click(screen.getByRole('button', { name: /Open this file/ }));
    expect(onOpenDiff).toHaveBeenCalledWith('src/changed.ts');
  });

  it('reports an unknown size as unknown, not as zero', async () => {
    render(<TreePanel {...treeProps} projection={projection([['a.ts', null]])} />);
    await userEvent.click(screen.getByRole('button', { name: /a\.ts/ }));
    expect(screen.getByText('Unknown here')).toBeInTheDocument();
  });
});
