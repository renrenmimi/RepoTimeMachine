/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangesPanel } from '@/components/ChangesPanel';
import { commits, detail, fileChange } from '../factories';

const range = commits(5);
const target = range[3]!;

const base = {
  pending: false,
  playing: false,
  focus: null,
  onOpenPatch: vi.fn(),
};

describe('ChangesPanel file list', () => {
  it('lists changed files with their line counts', () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'src/app/page.tsx', status: 'added', additions: 42, deletions: 0 }),
          fileChange({ path: 'src/old.ts', status: 'removed', additions: 0, deletions: 17 }),
        ])}
      />,
    );
    expect(screen.getByText('page.tsx')).toBeInTheDocument();
    expect(screen.getByText('+42')).toBeInTheDocument();
    expect(screen.getByText('−17')).toBeInTheDocument();
  });

  it('states each status in words as well as in colour', () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'a.ts', status: 'added' }),
          fileChange({ path: 'b.ts', status: 'removed' }),
          fileChange({ path: 'c.ts', status: 'renamed', previousPath: 'old.ts' }),
          fileChange({ path: 'd.ts', status: 'modified' }),
        ])}
      />,
    );
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
    expect(screen.getByText('renamed')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
  });

  it('shows where a renamed file came from, on its own line', () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' }),
        ])}
      />,
    );
    expect(screen.getByText(/Renamed from/)).toBeInTheDocument();
    expect(screen.getByText('src/old.ts')).toBeInTheDocument();
  });

  it('pages through a very long file list instead of rendering it all', async () => {
    const files = Array.from({ length: 150 }, (_, i) => fileChange({ path: `dir/f${i}.ts` }));
    render(<ChangesPanel {...base} detail={detail(target.sha, files)} />);

    expect(screen.queryByText('f149.ts')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show \d+ more files/ }));
    expect(screen.getByText('f149.ts')).toBeInTheDocument();
  });

  it('says how much of the list is on screen', () => {
    const files = Array.from({ length: 150 }, (_, i) => fileChange({ path: `dir/f${i}.ts` }));
    render(<ChangesPanel {...base} detail={detail(target.sha, files)} />);
    expect(screen.getByText('60 of 150 shown')).toBeInTheDocument();
  });

  it('warns that GitHub caps the file list at 300', () => {
    const files = Array.from({ length: 300 }, (_, i) => fileChange({ path: `f${i}.ts` }));
    render(
      <ChangesPanel {...base} detail={{ ...detail(target.sha, files), filesTruncated: true }} />,
    );
    expect(screen.getByText(/at most 300 files per commit/)).toBeInTheDocument();
  });
});

describe('ChangesPanel patches', () => {
  it('expands a patch on demand and marks the lines by symbol as well as colour', async () => {
    const patch = '@@ -1,2 +1,3 @@\n context\n-removed line\n+added line';
    render(
      <ChangesPanel
        {...base}
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

  it('pauses playback when a diff is opened, so the evidence stops moving', async () => {
    const onOpenPatch = vi.fn();
    render(
      <ChangesPanel
        {...base}
        onOpenPatch={onOpenPatch}
        detail={detail(target.sha, [fileChange({ path: 'a.ts', patch: '@@ -1 +1 @@\n+x' })])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /a\.ts/ }));
    expect(onOpenPatch).toHaveBeenCalledTimes(1);
  });

  it('renders hostile patch content as text', async () => {
    const patch = '@@ -1 +1 @@\n+<script>alert(1)</script>';
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [fileChange({ path: 'x.html', patch, additions: 1 })])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /x\.html/ }));
    expect(screen.getByLabelText('Diff for x.html')).toHaveTextContent('<script>alert(1)</script>');
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders a hostile file path as text', () => {
    const hostile = '<img src=x onerror=alert(1)>.ts';
    const { container } = render(
      <ChangesPanel {...base} detail={detail(target.sha, [fileChange({ path: hostile })])} />,
    );
    expect(container.textContent).toContain(hostile);
    expect(container.querySelector('img')).toBeNull();
  });

  it('offers to expand a long diff rather than scrolling it silently', async () => {
    const patch = ['@@ -1,40 +1,40 @@', ...Array.from({ length: 40 }, (_, i) => `+line ${i}`)].join('\n');
    render(<ChangesPanel {...base} detail={detail(target.sha, [fileChange({ path: 'long.ts', patch })])} />);
    await userEvent.click(screen.getByRole('button', { name: /long\.ts/ }));
    await userEvent.click(screen.getByRole('button', { name: /Expand all 41 lines/ }));
    expect(screen.getByRole('button', { name: /Collapse this diff/ })).toBeInTheDocument();
  });

  it('caps an enormous diff and says how much it is showing', async () => {
    const patch = ['@@ -1,400 +1,400 @@', ...Array.from({ length: 400 }, (_, i) => `+line ${i}`)].join('\n');
    render(<ChangesPanel {...base} detail={detail(target.sha, [fileChange({ path: 'huge.ts', patch })])} />);
    await userEvent.click(screen.getByRole('button', { name: /huge\.ts/ }));
    expect(screen.getByText(/Showing the first 320 of 401 diff lines/)).toBeInTheDocument();
  });
});

describe('ChangesPanel missing patches', () => {
  it('explains a binary file instead of showing a blank diff', async () => {
    render(
      <ChangesPanel
        {...base}
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
    expect(screen.getByText('Binary file — no text diff exists')).toBeInTheDocument();
    expect(screen.getByText(/no line-based diff for a binary file/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View this file on GitHub/ })).toBeInTheDocument();
  });

  it('explains an oversized diff', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'huge.json', patch: null, patchOmittedReason: 'too-large', additions: 90_000 }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /huge\.json/ }));
    expect(screen.getByText('Diff omitted by GitHub')).toBeInTheDocument();
    expect(screen.getByText(/too large/)).toBeInTheDocument();
  });

  it('says a missing patch is not the same as no change', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'mystery.ts', patch: null, patchOmittedReason: 'not-provided' }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /mystery\.ts/ }));
    expect(screen.getByText('No diff was provided')).toBeInTheDocument();
    expect(screen.getByText(/not the same as the file being/)).toBeInTheDocument();
  });

  it('says an aggregated total is a total, not a net diff', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({
            path: 'src/app.ts',
            patch: null,
            patchOmittedReason: 'aggregated',
            additions: 40,
            deletions: 12,
          }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /app\.ts/ }));
    expect(screen.getByText('Changed more than once in this range')).toBeInTheDocument();
    const text = screen.getByText(/cannot produce a single net diff/);
    expect(text).toHaveTextContent(/totals across those changes/);
    expect(text).toHaveTextContent(/not the size of the net difference/);
  });

  it('offers no GitHub link when the source has no object to link to', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'demo.ts', patch: null, patchOmittedReason: 'binary', blobUrl: null }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /demo\.ts/ }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says a generated file is withheld on purpose, not missing', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({
            path: 'package-lock.json',
            status: 'added',
            patch: null,
            patchOmittedReason: 'generated',
            additions: 1840,
          }),
        ])}
      />,
    );

    // Marked before it is opened, from the path, exactly as the tree marks it.
    expect(screen.getByText('generated')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /package-lock\.json/ }));
    expect(screen.getByText('Generated file — diff deliberately not shown')).toBeInTheDocument();
    // And it says the count is declared rather than taken from a diff.
    expect(screen.getByText(/declared to be, not a count taken from a diff/)).toBeInTheDocument();
  });

  it('says a pure rename is complete, not missing', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({
            path: 'components/library/library-card.tsx',
            previousPath: 'components/library/lesson-card.tsx',
            status: 'renamed',
            patch: null,
            patchOmittedReason: 'rename-only',
            additions: 0,
            deletions: 0,
          }),
        ])}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /library-card\.tsx/ }));
    expect(screen.getByText('Moved, with no change to its content')).toBeInTheDocument();
    expect(screen.getByText(/byte-for-byte identical/)).toBeInTheDocument();
  });

  it('says when a patch was cut short', async () => {
    render(
      <ChangesPanel
        {...base}
        detail={detail(target.sha, [
          fileChange({ path: 'b.ts', patch: '@@ -1 +1 @@\n+x', patchTruncated: true, additions: 1 }),
        ])}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /b\.ts/ }));
    expect(screen.getByText(/cut short/)).toBeInTheDocument();
  });
});

describe('ChangesPanel empty states', () => {
  it('says the diff is loading rather than showing an empty list', () => {
    render(<ChangesPanel {...base} detail={null} pending />);
    expect(screen.getByText(/Loading this commit/)).toBeInTheDocument();
  });

  it('explains a diff that has not loaded while playing', () => {
    render(<ChangesPanel {...base} detail={null} playing />);
    expect(screen.getByText(/Diffs load as playback passes each commit/)).toBeInTheDocument();
  });

  it('distinguishes a commit that changed nothing from one with no diff loaded', () => {
    render(<ChangesPanel {...base} detail={detail(target.sha, [])} />);
    expect(screen.getByText('This commit changed no files')).toBeInTheDocument();
    expect(screen.queryByText(/has not loaded/)).not.toBeInTheDocument();
  });
});

describe('ChangesPanel focus', () => {
  it('opens the diff of a file it was told to reveal', () => {
    render(
      <ChangesPanel
        {...base}
        focus={{ path: 'src/b.ts' }}
        detail={detail(target.sha, [
          fileChange({ path: 'src/a.ts', patch: '@@ -1 +1 @@\n+a' }),
          fileChange({ path: 'src/b.ts', patch: '@@ -1 +1 @@\n+b' }),
        ])}
      />,
    );
    expect(screen.getByLabelText('Diff for src/b.ts')).toBeInTheDocument();
    expect(screen.queryByLabelText('Diff for src/a.ts')).not.toBeInTheDocument();
  });

  it('reaches a file that sits past the first page of the list', () => {
    const files = Array.from({ length: 150 }, (_, i) =>
      fileChange({ path: `dir/f${i}.ts`, patch: `@@ -1 +1 @@\n+${i}` }),
    );
    render(<ChangesPanel {...base} focus={{ path: 'dir/f120.ts' }} detail={detail(target.sha, files)} />);
    expect(screen.getByLabelText('Diff for dir/f120.ts')).toBeInTheDocument();
  });
});
