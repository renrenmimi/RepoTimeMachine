/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpenedDiff } from '@/components/FileChangeList';
import { ReplayView, type SubView } from '@/components/ReplayView';
import { EMPTY_TREE_VIEW, type TreeViewState } from '@/components/TreePanel';
import { initialPlaybackState } from '@/lib/playback/machine';
import type { Milestone } from '@/lib/milestones/detect';
import type { Projection } from '@/lib/tree/projector';
import type { ChangeMap, FileSet } from '@/lib/tree/build';
import { commit, commits, detail, fileChange, sha } from '../factories';

const range = commits(16);

function projection(
  files: [string, number | null][] = [['src/app.ts', 100]],
  changes: ChangeMap = new Map(),
  overrides: Partial<Projection> = {},
): Projection {
  const set: FileSet = new Map(files.map(([path, size]) => [path, { size, sha: sha(path) }]));
  return {
    commitIndex: 0,
    files: set,
    changes,
    ghosts: [],
    fidelity: 'exact',
    missingCommits: 0,
    sourceIndex: 0,
    sourceTruncated: false,
    ...overrides,
  };
}

/**
 * The shell, as far as the replay can tell.
 *
 * The sub-view, the diff focus and the tree's own state are held above
 * `ReplayView` in the real application — it unmounts on a view change — so the
 * harness has to hold them too for the interactions to behave as they do there.
 */
type ShellHeld = 'subView' | 'onSubView' | 'diffFocus' | 'onDiffFocus' | 'openedDiff' | 'onOpenedDiff' | 'treeView' | 'onTreeView';

function Harness(props: Omit<Parameters<typeof ReplayView>[0], ShellHeld>) {
  const [subView, setSubView] = useState<SubView>('repository');
  const [diffFocus, setDiffFocus] = useState<{ path: string } | null>(null);
  const [openedDiff, setOpenedDiff] = useState<OpenedDiff | null>(null);
  const [treeView, setTreeView] = useState<TreeViewState>(EMPTY_TREE_VIEW);

  return (
    <ReplayView
      {...props}
      subView={subView}
      onSubView={setSubView}
      diffFocus={diffFocus}
      onDiffFocus={setDiffFocus}
      openedDiff={openedDiff}
      onOpenedDiff={setOpenedDiff}
      treeView={treeView}
      onTreeView={setTreeView}
    />
  );
}

function setup(overrides: Partial<Parameters<typeof ReplayView>[0]> = {}) {
  const handlers = {
    onSeek: vi.fn(),
    onPlayPause: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onLatest: vi.fn(),
    onSpeed: vi.fn(),
    onLoadOlder: vi.fn(),
    onPause: vi.fn(),
    onShowMilestones: vi.fn(),
  };
  const current = (overrides.currentCommit ?? range[0]) as (typeof range)[number];
  render(
    <Harness
      commits={range}
      playback={{ ...initialPlaybackState(range.length, current.index) }}
      currentCommit={current}
      previousCommit={null}
      detail={null}
      detailPending={false}
      details={new Map()}
      projection={projection()}
      commitMilestones={[]}
      milestones={[]}
      tags={[]}
      totalCommits={range.length}
      hasOlder={false}
      loadingOlder={false}
      canLoadOlder
      snapshotLoading={false}
      rangeLabel="the whole history, 16 commits"
      version={1}
      reducedMotion={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ReplayView commit heading', () => {
  it('states the position, the date and the subject, in that order', () => {
    setup({ currentCommit: commit({ index: 0, subject: 'chore: scaffold the shell' }) });

    const position = document.getElementById('replay-position')!;
    expect(position).toHaveTextContent('Commit 1 of 16');
    expect(position).toHaveTextContent('UTC');

    const subject = document.getElementById('selected-commit-subject')!;
    expect(subject).toHaveTextContent('chore: scaffold the shell');
    // The heading follows the position in the document, which is the reading order.
    expect(position.compareDocumentPosition(subject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a hostile commit subject as text, not markup', () => {
    const hostile = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
    setup({ currentCommit: commit({ index: 0, subject: hostile }) });

    expect(document.getElementById('selected-commit-subject')).toHaveTextContent(hostile);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders a hostile author name as text', () => {
    const target = commit({ index: 0 });
    setup({
      currentCommit: { ...target, author: { ...target.author, name: '<b>not bold</b>' } },
    });
    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('links the sha to the real commit when there is one', () => {
    const target = commit({ index: 0 });
    setup({ currentCommit: target });
    const link = screen.getByRole('link', { name: new RegExp(target.shortSha) });
    expect(link).toHaveAttribute('href', target.htmlUrl);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('offers no link at all when the source has no commit to open', () => {
    setup({ currentCommit: commit({ index: 0, htmlUrl: null }) });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTitle(/no repository to open/)).toBeInTheDocument();
  });

  it('collapses a long commit body behind a toggle', async () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    setup({ currentCommit: commit({ index: 0, body }) });

    expect(screen.queryByText(/line 19/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Commit details' }));
    await userEvent.click(screen.getByRole('button', { name: /Show all 20 lines/ }));
    expect(screen.getByText(/line 19/)).toBeInTheDocument();
  });

  it('pauses playback when the commit body is opened to be read', async () => {
    const handlers = setup({ currentCommit: commit({ index: 0, body: 'A long explanation.' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Commit details' }));
    expect(handlers.onPause).toHaveBeenCalled();
  });

  it('summarises the diff as arithmetic, with no generated prose', () => {
    const target = range[3]!;
    setup({
      currentCommit: target,
      detail: detail(target.sha, [
        fileChange({ path: 'a.ts', additions: 100, deletions: 0 }),
        fileChange({ path: 'b.ts', additions: 30, deletions: 0 }),
      ]),
    });
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('+130')).toBeInTheDocument();
    expect(screen.getByText('−0')).toBeInTheDocument();
  });

  it('says the summary is unavailable rather than showing zeroes', () => {
    setup({ detail: null, detailPending: true });
    expect(screen.getByText(/Loading the file changes/)).toBeInTheDocument();
  });
});

describe('ReplayView milestones', () => {
  const milestone = (id: string, overrides: Partial<Milestone> = {}): Milestone => ({
    id,
    sha: range[0]!.sha,
    commitIndex: 0,
    kind: 'first-manifest',
    label: 'First package manifest',
    rule: 'A dependency manifest appears.',
    evidence: 'package.json is added here.',
    confidence: 'exact',
    ...overrides,
  });

  it('states them on one line, not as cards above the changes', () => {
    setup({ commitMilestones: [milestone('a'), milestone('b', { label: 'First test file' })] });

    // Counted as milestones, which is not a count of commits or of phases.
    expect(screen.getByText('2 detected milestones')).toBeInTheDocument();
    // The evidence is behind a disclosure, so it is not in front of the diff.
    expect(screen.queryByText('package.json is added here.')).not.toBeInTheDocument();
  });

  it('shows the rule and the evidence on request', async () => {
    setup({
      commitMilestones: [
        milestone('a', { confidence: 'window', window: { fromIndex: 1, toIndex: 3 } }),
      ],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    expect(screen.getByText('package.json is added here.')).toBeInTheDocument();
    expect(screen.getByText(/Rule: A dependency manifest appears/)).toBeInTheDocument();
    expect(screen.getByText(/narrowed to commits 2–4/)).toBeInTheDocument();
  });

  it('marks an approximate position on the collapsed line itself', () => {
    setup({
      commitMilestones: [
        milestone('a', { confidence: 'window', window: { fromIndex: 1, toIndex: 3 } }),
      ],
    });
    expect(screen.getByText('1 detected milestone')).toHaveAttribute('data-approximate', 'true');
  });

  it('sends the visitor to Insights for the whole list', async () => {
    const handlers = setup({ commitMilestones: [milestone('a')] });
    await userEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    await userEvent.click(screen.getByRole('button', { name: /All milestones in Insights/ }));
    expect(handlers.onShowMilestones).toHaveBeenCalledTimes(1);
  });
});

describe('ReplayView sub-views', () => {
  it('opens on the repository, with the change count on the other tab', () => {
    const target = range[3]!;
    setup({
      currentCommit: target,
      detail: detail(target.sha, [fileChange({ path: 'a.ts' }), fileChange({ path: 'b.ts' })]),
    });

    expect(screen.getByRole('tab', { name: 'Repository' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Changes \(2\)/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('Repository files at this commit')).toBeInTheDocument();
  });

  it('switches to the changes without touching the heading', async () => {
    const target = range[3]!;
    setup({
      currentCommit: target,
      detail: detail(target.sha, [fileChange({ path: 'a.ts', patch: '@@ -1 +1 @@\n+a' })]),
    });

    const subject = document.getElementById('selected-commit-subject')!.textContent;
    await userEvent.click(screen.getByRole('tab', { name: /Changes/ }));

    expect(screen.getByLabelText('Files changed by this commit')).toBeInTheDocument();
    // Same commit, same heading: only the panel underneath changed.
    expect(document.getElementById('selected-commit-subject')!.textContent).toBe(subject);
  });

  it('opens a file diff from the tree, on the same commit, and pauses', async () => {
    const target = range[3]!;
    const changes: ChangeMap = new Map([
      ['src/app.ts', { status: 'modified', previousPath: null, additions: 2, deletions: 1 }],
    ]);
    const handlers = setup({
      currentCommit: target,
      projection: projection([['src/app.ts', 100]], changes),
      detail: detail(target.sha, [fileChange({ path: 'src/app.ts', patch: '@@ -1 +1 @@\n+x' })]),
    });

    const subject = document.getElementById('selected-commit-subject')!.textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Open the diff for src/app.ts' }));

    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Diff for src/app.ts')).toBeInTheDocument();
    expect(document.getElementById('selected-commit-subject')!.textContent).toBe(subject);
    expect(handlers.onPause).toHaveBeenCalled();
  });

  it('keeps the player on screen with the content it controls', () => {
    setup();
    // Both present in the same view, which is the point of compressing the row.
    expect(screen.getByRole('slider', { name: /Commit position/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Repository files at this commit')).toBeInTheDocument();
  });
});

describe('ReplayView history', () => {
  it('lists the loaded commits in playback order, numbered to match', () => {
    setup();
    const list = screen.getByLabelText('Commit history');
    const first = list.querySelectorAll('[class*="itemSubject"]')[0];
    expect(first).toHaveTextContent(range[0]!.subject);
    // The list says how long it is; the player says whether the track covers
    // the whole history. Two different facts, worded differently.
    expect(screen.getByText('All 16 commits')).toBeInTheDocument();
    expect(screen.getByText('the whole history, 16 commits')).toBeInTheDocument();
  });

  it('marks the current commit for more than colour', () => {
    setup({ currentCommit: range[4] });
    const current = document.querySelector('[aria-current="true"]');
    expect(current).toHaveTextContent(range[4]!.subject);
  });

  it('filters on the commit metadata it actually holds', async () => {
    setup();
    const filter = screen.getByLabelText(/Filter loaded commits/);
    await userEvent.type(filter, range[7]!.subject);
    expect(screen.getByText(/1 of 16 loaded commits match/)).toBeInTheDocument();
  });

  it('says a filter with no hits looks at messages, not code', async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/Filter loaded commits/), 'zzzzzzzz');
    expect(screen.getByText('No commits match')).toBeInTheDocument();
    expect(screen.getByText(/not at file contents/)).toBeInTheDocument();
  });

  it('names the sort order rather than reversing silently', async () => {
    setup();
    const order = screen.getByRole('button', { name: /Sort order: oldest first/ });
    expect(order).toHaveTextContent('Oldest first');
    await userEvent.click(order);
    expect(screen.getByRole('button', { name: /Sort order: newest first/ })).toHaveTextContent('Newest first');
  });

  it('states the real range and the session cap when older history exists', () => {
    setup({ totalCommits: 640, hasOlder: true, canLoadOlder: false });
    expect(screen.getByText('Latest 16 of 640 commits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session limit reached' })).toBeDisabled();
    expect(screen.getByText(/at most 1,000 commits/)).toBeInTheDocument();
  });

  it('offers to load older history when there is more and room for it', async () => {
    const handlers = setup({ totalCommits: 640, hasOlder: true, canLoadOlder: true });
    await userEvent.click(screen.getByRole('button', { name: 'Load 100 older commits' }));
    expect(handlers.onLoadOlder).toHaveBeenCalledTimes(1);
    expect(screen.getByText('16 of 640 commits loaded.')).toBeInTheDocument();
  });
});
