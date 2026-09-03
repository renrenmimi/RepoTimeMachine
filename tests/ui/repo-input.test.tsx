/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoInput } from '@/components/RepoInput';

describe('RepoInput', () => {
  it('submits a valid reference', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'octocat/hello-world');
    await userEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'octocat/hello-world' }));
  });

  it('accepts a pasted GitHub URL', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'https://github.com/octocat/Spoon-Knife/tree/main');
    await userEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'octocat/Spoon-Knife' }));
  });

  it('refuses a non-GitHub host and explains why', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'https://gitlab.com/a/b');
    await userEvent.click(screen.getByRole('button', { name: 'Load repository' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Only github.com repositories/);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses an empty submission', async () => {
    const onSubmit = vi.fn();
    render(<RepoInput current={null} busy={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter a repository/);
  });

  it('clears the error as soon as the visitor edits the field', async () => {
    render(<RepoInput current={null} busy={false} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load repository' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'a');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows whatever repository is loaded', () => {
    render(
      <RepoInput
        current={{ owner: 'octocat', repo: 'example-repo', slug: 'octocat/example-repo' }}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('octocat/example-repo');
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
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });
});

describe('RepoInput cancelling', () => {
  it('offers a cancel only where there is something to go back to', () => {
    const { rerender } = render(<RepoInput current={null} busy={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    rerender(<RepoInput current={null} busy={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('abandons the edit and keeps the loaded repository', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RepoInput
        current={{ owner: 'a', repo: 'b', slug: 'a/b' }}
        busy={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'someone/else');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    // The field is back to what is actually loaded.
    expect(screen.getByRole('textbox')).toHaveValue('a/b');
  });

  it('states only what the field needs, not every limit', () => {
    render(<RepoInput current={null} busy={false} onSubmit={vi.fn()} />);
    const hint = screen.getByText(/Public repositories only/);
    expect(hint).toHaveTextContent(/default branch/);
    expect(hint).not.toHaveTextContent(/rate limit/i);
  });

  it('has a visible label, not just a placeholder', () => {
    render(<RepoInput current={null} busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Open a public repository')).toBe(screen.getByRole('textbox'));
  });
});
