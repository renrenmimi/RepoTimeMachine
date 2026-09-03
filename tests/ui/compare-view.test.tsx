/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompareView } from '@/components/CompareView';
import type { CompareState } from '@/lib/client/history-controller';
import type { CompareEndpoint, RepoCompare } from '@/lib/domain/types';
import type { Projection } from '@/lib/tree/projector';
import type { FileSet } from '@/lib/tree/build';
import { commits, fileChange, sha } from '../factories';

const range = commits(12);

const endpoint = (index: number, overrides: Partial<CompareEndpoint> = {}): CompareEndpoint => ({
  kind: 'commit',
  tagName: null,
  sha: range[index]!.sha,
  shortSha: range[index]!.shortSha,
  subject: range[index]!.subject,
  authorName: 'Fixture Author',
  date: range[index]!.author.date,
  htmlUrl: null,
  ...overrides,
});

function repoCompare(overrides: Partial<RepoCompare> = {}): RepoCompare {
  return {
    base: endpoint(2),
    head: endpoint(7),
    status: 'ahead',
    aheadBy: 5,
    behindBy: 0,
    commits: range.slice(3, 8),
    commitsTruncated: false,
    files: [fileChange({ path: 'src/app.ts', additions: 20, deletions: 4, patch: '@@ -1 +1 @@\n+x' })],
    filesTruncated: false,
    additions: 20,
    deletions: 4,
    changedFiles: 1,
    mergeBaseSha: null,
    htmlUrl: null,
    ...overrides,
  };
}

function compareState(overrides: Partial<CompareState> = {}): CompareState {
  return {
    draftBase: range[2]!.sha,
    draftHead: range[7]!.sha,
    draftBaseLabel: null,
    draftHeadLabel: null,
    base: range[2]!.sha,
    head: range[7]!.sha,
    baseLabel: null,
    headLabel: null,
    status: 'ready',
    data: repoCompare(),
    error: null,
    ...overrides,
  };
}

function projection(files: string[]): Projection {
  const set: FileSet = new Map(files.map((path) => [path, { size: 100, sha: sha(path) }]));
  return {
    commitIndex: 0,
    files: set,
    changes: new Map(),
    ghosts: [],
    fidelity: 'exact',
    missingCommits: 0,
    sourceIndex: 0,
    sourceTruncated: false,
  };
}

function setup(overrides: Partial<Parameters<typeof CompareView>[0]> = {}) {
  const handlers = {
    onPick: vi.fn(),
    onSwap: vi.fn(),
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    onOpenInReplay: vi.fn(),
  };
  render(
    <CompareView
      compare={compareState()}
      commits={range}
      tags={[]}
      tagsStatus="ready"
      baseProjection={null}
      headProjection={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('CompareView selection', () => {
  it('names both ends in plain language, with the Git terms as hints', () => {
    setup();
    expect(screen.getByRole('button', { name: /^From/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^To/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^From/ })).toHaveTextContent('base');
    expect(screen.getByRole('button', { name: /^To/ })).toHaveTextContent('head');
  });

  it('submits the pair through an explicit action', async () => {
    const handlers = setup({
      compare: compareState({ draftHead: range[9]!.sha, status: 'ready' }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('has nothing to submit when the loaded comparison is the chosen one', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
  });

  it('puts a stale result away rather than showing it under new endpoints', () => {
    setup({ compare: compareState({ draftHead: range[9]!.sha }) });

    expect(screen.getByText('Selection changed')).toBeInTheDocument();
    expect(screen.getByText(/was for the previous pair/)).toBeInTheDocument();
    // The numbers from the old pair are gone, not relabelled.
    expect(screen.queryByText('Files changed')).not.toBeInTheDocument();
  });

  it('offers a swap that changes the selection without running it', async () => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Swap the two ends of the comparison' }));
    expect(handlers.onSwap).toHaveBeenCalledTimes(1);
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('asks before requesting anything when a pair is only proposed', () => {
    setup({ compare: compareState({ base: null, head: null, status: 'idle', data: null }) });
    expect(screen.getByText('Ready when you are')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
  });

  it('asks for a pair when neither end has been chosen', () => {
    setup({
      compare: compareState({ draftBase: null, draftHead: null, base: null, head: null, status: 'idle', data: null }),
    });
    expect(screen.getByText('Choose two points')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
  });
});

describe('CompareView result', () => {
  it('states the relation with the moved end as the subject', () => {
    setup();
    const sentence = screen.getByText(
      new RegExp(`^${range[7]!.shortSha} is 5 commits ahead of ${range[2]!.shortSha}\\.`),
    );
    expect(sentence).toBeInTheDocument();
  });

  it('gives one row of core figures, not a wall of them', () => {
    setup();
    const metrics = document.querySelector('dl')!;
    expect(metrics).toHaveTextContent('Files changed');
    expect(metrics).toHaveTextContent('+20');
    expect(metrics).toHaveTextContent('−4');
    // Three figures, not a dashboard.
    expect(metrics.querySelectorAll('dd')).toHaveLength(3);
  });

  it('opens on the file changes, with the other two reachable', async () => {
    setup();
    expect(screen.getByRole('tab', { name: /File changes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('app.ts')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent(range[7]!.subject);

    await userEvent.click(screen.getByRole('tab', { name: 'Repository stats' }));
    expect(screen.getByText(/No file tree is loaded at either end/)).toBeInTheDocument();
  });

  it('moves the replay only through an explicit action', async () => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Open in Replay' })[0]!);
    expect(handlers.onOpenInReplay).toHaveBeenCalled();
  });

  it('cannot open a commit that is outside the loaded range', async () => {
    setup({
      compare: compareState({
        data: repoCompare({ commits: [commits(30)[25]!] }),
      }),
    });
    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));
    expect(screen.getByRole('button', { name: 'Open in Replay' })).toBeDisabled();
  });
});

describe('CompareView directions', () => {
  it('says the same commit is the same commit, and keeps the selectors', () => {
    setup({
      compare: compareState({
        draftHead: range[2]!.sha,
        head: range[2]!.sha,
        data: repoCompare({ head: endpoint(2), status: 'identical', aheadBy: 0, files: [], changedFiles: 0 }),
      }),
    });
    expect(screen.getByText('These are the same commit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^From/ })).toBeInTheDocument();
    // Not an error, and not three empty charts.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    // And no request to make: the answer needs no round trip.
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
  });

  it('does not call a behind comparison "no difference"', async () => {
    setup({
      compare: compareState({
        data: repoCompare({ status: 'behind', aheadBy: 0, behindBy: 5, commits: [] }),
      }),
    });
    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));

    expect(screen.getByText('No commit is ahead')).toBeInTheDocument();
    expect(screen.getByText(/5 commits would have to be undone/)).toBeInTheDocument();
    expect(screen.queryByText(/no difference/i)).not.toBeInTheDocument();
  });

  it('keeps the common ancestor in view for a diverged pair', async () => {
    setup({
      compare: compareState({
        data: repoCompare({ status: 'diverged', aheadBy: 3, behindBy: 2, mergeBaseSha: sha('ancestor') }),
      }),
    });
    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));
    expect(screen.getByText(/common ancestor/)).toBeInTheDocument();
  });

  it('says a truncated commit list is truncated', async () => {
    setup({ compare: compareState({ data: repoCompare({ aheadBy: 900, commitsTruncated: true }) }) });
    await userEvent.click(screen.getByRole('tab', { name: /Commits/ }));
    expect(screen.getByText(/at most 250 per comparison/)).toBeInTheDocument();
  });
});

describe('CompareView statistics', () => {
  it('labels each side by direction and by sha', async () => {
    setup({
      baseProjection: projection(['a.ts', 'b.ts']),
      headProjection: projection(['a.ts', 'b.ts', 'c.ts']),
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Repository stats' }));

    expect(screen.getByRole('columnheader', { name: new RegExp(`From ${range[2]!.shortSha}`) })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: new RegExp(`To ${range[7]!.shortSha}`) })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Files tracked' })).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('leaves the difference unavailable rather than estimating it', async () => {
    setup({ baseProjection: null, headProjection: projection(['a.ts']) });
    await userEvent.click(screen.getByRole('tab', { name: 'Repository stats' }));

    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText(/blank rather than estimated/)).toBeInTheDocument();
  });

  it('calls the file-type mix an estimate from extensions', async () => {
    setup({ baseProjection: projection(['a.ts']), headProjection: projection(['a.ts', 'b.ts']) });
    await userEvent.click(screen.getByRole('tab', { name: 'Repository stats' }));
    expect(screen.getByText('estimate from extensions')).toBeInTheDocument();
    expect(screen.getByText(/not from reading file contents/)).toBeInTheDocument();
  });
});

describe('CompareView failures', () => {
  it('explains a failure and keeps the way out', () => {
    const handlers = setup({
      compare: compareState({
        status: 'error',
        data: null,
        error: { code: 'rate-limited', message: 'GitHub rate limit reached.', retryAt: null },
      }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent('GitHub rate limit reached.');
    // The selectors survive, so another pair can be tried.
    expect(screen.getByRole('button', { name: /^From/ })).toBeInTheDocument();
    return userEvent.click(screen.getByRole('button', { name: 'Try again' })).then(() => {
      expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    });
  });

  it('says it is working while a comparison is in flight', () => {
    setup({ compare: compareState({ status: 'loading', data: null }) });
    expect(screen.getByText('Reading the difference…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comparing…' })).toBeDisabled();
  });
});
