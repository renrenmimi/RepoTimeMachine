/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transport } from '@/components/Transport';
import { initialPlaybackState, type PlaybackState } from '@/lib/playback/machine';
import type { Milestone } from '@/lib/milestones/detect';
import { commits } from '../factories';

const range = commits(20);

const milestone = (commitIndex: number): Milestone => ({
  id: `initial-commit:${commitIndex}`,
  sha: range[commitIndex]!.sha,
  commitIndex,
  kind: 'initial-commit',
  label: 'Initial commit',
  rule: 'The commit has no parent.',
  evidence: 'This is the first commit in the repository.',
  confidence: 'exact',
});

function setup(overrides: Partial<PlaybackState> = {}, props: Partial<Parameters<typeof Transport>[0]> = {}) {
  const handlers = {
    onPlayPause: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onSeek: vi.fn(),
    onSpeed: vi.fn(),
    onLatest: vi.fn(),
  };
  const playback = { ...initialPlaybackState(range.length, 0), ...overrides };
  render(
    <Transport
      playback={playback}
      commits={range}
      milestones={[milestone(0), milestone(7)]}
      rangeLabel="the whole history, 20 commits"
      disabled={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('Transport controls', () => {
  it('labels the play button by what it will do', () => {
    setup({ playing: false });
    const play = screen.getByRole('button', { name: 'Play history' });
    expect(play).toHaveAttribute('aria-pressed', 'false');
    // A bare triangle is not an entry point, so the control carries the word.
    expect(play).toHaveTextContent('Play');
  });

  it('offers a replay at the end of the range instead of a dead button', () => {
    setup({ index: range.length - 1, playing: false });
    const play = screen.getByRole('button', {
      name: 'Replay the history from the first loaded commit',
    });
    expect(play).toBeEnabled();
    expect(play).toHaveTextContent('Replay');
  });

  it('jumps to the newest commit in the range', async () => {
    const handlers = setup({ index: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(handlers.onLatest).toHaveBeenCalledTimes(1);
  });

  it('has nothing to jump to when already on the newest commit', () => {
    setup({ index: range.length - 1 });
    expect(screen.getByRole('button', { name: 'Latest' })).toBeDisabled();
  });

  it('switches to a pause label while playing', () => {
    setup({ playing: true });
    const button = screen.getByRole('button', { name: 'Pause playback' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('Pause');
  });

  it('calls the play handler on click', async () => {
    const handlers = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play history' }));
    expect(handlers.onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('steps forward and backward', async () => {
    const handlers = setup({ index: 5 });
    await userEvent.click(screen.getByRole('button', { name: 'Next commit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous commit' }));
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('disables the step buttons at the ends of the range', () => {
    setup({ index: 0 });
    expect(screen.getByRole('button', { name: 'Previous commit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next commit' })).toBeEnabled();
  });

  it('explains a single-commit range instead of just disabling play', () => {
    render(
      <Transport
        playback={initialPlaybackState(1, 0)}
        commits={commits(1)}
        milestones={[]}
        rangeLabel="the whole history, 1 commit"
        disabled={false}
        onPlayPause={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        onSpeed={vi.fn()}
        onLatest={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play history' })).toBeDisabled();
    expect(screen.getByText(/one commit in this range/)).toBeInTheDocument();
  });
});

describe('Transport speed', () => {
  it('marks the active speed and offers the rest', () => {
    setup({ speed: 2 });
    const group = screen.getByRole('group', { name: 'Playback speed' });
    const pressed = group.querySelectorAll('[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain('2');
  });

  it('reports a speed change without touching anything else', async () => {
    const handlers = setup({ index: 9, playing: true, speed: 1 });
    await userEvent.click(screen.getByRole('button', { name: /^4/ }));
    expect(handlers.onSpeed).toHaveBeenCalledWith(4);
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onPlayPause).not.toHaveBeenCalled();
  });
});

describe('Transport scrubber', () => {
  it('exposes a slider carrying the commit position', () => {
    setup({ index: 4 });
    const slider = screen.getByRole('slider', { name: /Commit position/ });
    expect(slider).toHaveValue('4');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('Commit 5 of 20'));
  });

  it('describes the selected commit in the slider text, for screen readers', () => {
    setup({ index: 3 });
    expect(screen.getByRole('slider', { name: /Commit position/ })).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('commit 3'),
    );
  });

  it('reports a drag as a seek', () => {
    const handlers = setup({ index: 4 });
    const slider = screen.getByRole('slider', { name: /Commit position/ });
    fireEvent.change(slider, { target: { value: '11' } });
    expect(handlers.onSeek).toHaveBeenCalledWith(11);
  });

  it('is reachable by keyboard', async () => {
    setup({ index: 4 });
    const slider = screen.getByRole('slider', { name: /Commit position/ });
    slider.focus();
    expect(slider).toHaveFocus();
  });
});

describe('Transport read-out', () => {
  it('shows the honest range label', () => {
    setup({ index: 6 });
    expect(screen.getByText('the whole history, 20 commits')).toBeInTheDocument();
  });

  it('states the position for a screen reader on the slider itself', () => {
    // The visible position lives in the commit heading directly above this
    // row, so repeating it here would only be noise on screen.
    setup({ index: 6 });
    expect(screen.getByRole('slider', { name: /Commit position/ })).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('Commit 7 of 20'),
    );
  });

  it('says so when nothing is loaded', () => {
    render(
      <Transport
        playback={initialPlaybackState(0, 0)}
        commits={[]}
        milestones={[]}
        rangeLabel="no commits loaded"
        disabled
        onPlayPause={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        onSpeed={vi.fn()}
        onLatest={vi.fn()}
      />,
    );
    expect(screen.getAllByText('no commits loaded').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Play history' })).toBeDisabled();
  });

  it('places one marker per milestone commit, not per milestone', () => {
    const { container } = render(
      <Transport
        playback={initialPlaybackState(range.length, 0)}
        commits={range}
        milestones={[milestone(3), { ...milestone(3), id: 'merge-commit:x', kind: 'merge-commit' }, milestone(9)]}
        rangeLabel="x"
        disabled={false}
        onPlayPause={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        onSpeed={vi.fn()}
        onLatest={vi.fn()}
      />,
    );
    // One mark per commit that matched, not one per rule that fired.
    const marks = container.querySelectorAll('[class*="milestoneMark"]');
    expect(marks).toHaveLength(2);
  });

  it('keeps milestone markers out of the tab order', () => {
    const { container } = render(
      <Transport
        playback={initialPlaybackState(range.length, 0)}
        commits={range}
        milestones={[milestone(3)]}
        rangeLabel="x"
        disabled={false}
        onPlayPause={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onSeek={vi.fn()}
        onSpeed={vi.fn()}
        onLatest={vi.fn()}
      />,
    );
    /*
     * They are marks, not controls: 260 unreachable buttons in the tab order
     * was worse than none, and jumping to a milestone is a named action in the
     * history list and in Insights.
     */
    const marks = container.querySelectorAll('[class*="milestoneMark"]');
    expect(marks).toHaveLength(1);
    for (const mark of marks) {
      expect(mark.tagName).not.toBe('BUTTON');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
