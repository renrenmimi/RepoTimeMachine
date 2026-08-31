/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComparePicker } from '@/components/ComparePicker';
import type { Tag } from '@/lib/domain/types';
import { commits } from '../factories';

const range = commits(6);
const tags: Tag[] = [
  { name: 'v1.0.0', sha: range[4]!.sha },
  { name: 'v0.1.0', sha: range[1]!.sha },
];

function setup(overrides: Partial<Parameters<typeof ComparePicker>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <ComparePicker
      side="base"
      commits={range}
      tags={tags}
      selected={null}
      selectedLabel={null}
      onPick={onPick}
      {...overrides}
    />,
  );
  return { onPick };
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: /base/i }));
};

/** The chosen option, by the attribute the stylesheet keys off. */
const selectedOptions = () => document.querySelectorAll('[data-selected]');

describe('ComparePicker selection', () => {
  it('marks nothing as selected when no choice has been made', async () => {
    setup({ selected: null });
    await open();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // A null selection must not accidentally match an option.
    expect(selectedOptions()).toHaveLength(0);
  });

  it('marks the matching option for a full sha', async () => {
    setup({ selected: range[3]!.sha });
    await open();

    const marked = selectedOptions();
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain(range[3]!.shortSha);
  });

  it('marks the matching option for an abbreviated sha, as a shared link carries', async () => {
    setup({ selected: range[3]!.sha.slice(0, 10) });
    await open();

    const marked = selectedOptions();
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain(range[3]!.shortSha);
  });

  it('marks the tag whose commit is selected', async () => {
    setup({ selected: range[4]!.sha, selectedLabel: 'v1.0.0' });
    await open();

    const marked = [...selectedOptions()].map((node) => node.textContent ?? '');
    expect(marked.some((text) => text.includes('v1.0.0'))).toBe(true);
  });

  it('does not mark an option for a sha outside the range', async () => {
    setup({ selected: '0'.repeat(40) });
    await open();
    expect(selectedOptions()).toHaveLength(0);
  });

  it('shows the tag name on the button when one was chosen', () => {
    setup({ selected: range[4]!.sha, selectedLabel: 'v1.0.0' });
    expect(screen.getByRole('button', { name: /base/i })).toHaveTextContent('v1.0.0');
  });

  it('falls back to the abbreviated sha when no tag labels the choice', () => {
    setup({ selected: range[2]!.sha });
    expect(screen.getByRole('button', { name: /base/i })).toHaveTextContent(range[2]!.sha.slice(0, 7));
  });

  it('says nothing is chosen when nothing is', () => {
    setup({ selected: null });
    expect(screen.getByRole('button', { name: /base/i })).toHaveTextContent('choose');
  });
});

describe('ComparePicker choosing', () => {
  it('reports a commit choice without a tag name', async () => {
    const { onPick } = setup();
    await open();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(range[3]!.subject) }));

    expect(onPick).toHaveBeenCalledWith({ sha: range[3]!.sha, tagName: null });
  });

  it('reports a tag choice with its name', async () => {
    const { onPick } = setup();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /^v1\.0\.0/ }));

    expect(onPick).toHaveBeenCalledWith({ sha: range[4]!.sha, tagName: 'v1.0.0' });
  });

  it('closes after a choice', async () => {
    setup();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /^v1\.0\.0/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('only offers tags that point inside the loaded range', async () => {
    setup({ tags: [...tags, { name: 'v9.9.9', sha: '0'.repeat(40) }] });
    await open();

    // A tag outside the range cannot be shown on the timeline, so offering it
    // would promise something the view cannot keep.
    expect(screen.queryByRole('button', { name: /^v9\.9\.9/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^v1\.0\.0/ })).toBeInTheDocument();
  });
});

describe('ComparePicker searching', () => {
  it('filters commits by subject', async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText('Filter the base choices'), range[2]!.subject);

    expect(screen.getByRole('button', { name: new RegExp(range[2]!.subject) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(range[5]!.subject) })).not.toBeInTheDocument();
  });

  it('filters commits by sha prefix', async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText('Filter the base choices'), range[3]!.sha.slice(0, 8));

    expect(screen.getByRole('button', { name: new RegExp(range[3]!.subject) })).toBeInTheDocument();
  });

  it('filters tags by name', async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText('Filter the base choices'), 'v0.1');

    expect(screen.getByRole('button', { name: /^v0\.1\.0/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^v1\.0\.0/ })).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText('Filter the base choices'), 'nothing matches this');

    expect(screen.getByText(/Nothing in the loaded range matches/)).toBeInTheDocument();
  });

  it('keeps the selection marked while filtering', async () => {
    setup({ selected: range[3]!.sha });
    await open();
    await userEvent.type(screen.getByLabelText('Filter the base choices'), range[3]!.subject);

    expect(selectedOptions()).toHaveLength(1);
  });
});

describe('ComparePicker dismissal', () => {
  it('closes on Escape and leaves the button focusable', async () => {
    setup();
    await open();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: /base/i });
    button.focus();
    expect(button).toHaveFocus();
  });

  it('focuses the filter field when it opens, so typing goes there', async () => {
    setup();
    await open();
    expect(screen.getByLabelText('Filter the base choices')).toHaveFocus();
  });

  it('closes on a click outside itself', async () => {
    setup();
    await open();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles shut when the button is pressed again', async () => {
    setup();
    await open();
    await open();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open at all when disabled', async () => {
    setup({ disabled: true });
    await open();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ComparePicker labelling', () => {
  it('names the side it sets, for both the button and the dialog', async () => {
    render(
      <ComparePicker
        side="head"
        commits={range}
        tags={tags}
        selected={null}
        selectedLabel={null}
        onPick={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /head/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: /choose the head of the comparison/i });
    expect(within(dialog).getByLabelText('Filter the head choices')).toBeInTheDocument();
  });
});
