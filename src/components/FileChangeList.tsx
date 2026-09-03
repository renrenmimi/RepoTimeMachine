'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileChange } from '@/lib/domain/types';
import { formatNumber, splitPath } from '@/lib/format';
import styles from './file-changes.module.css';

/**
 * A list of changed files, each expandable to its diff.
 *
 * Shared by the replay and the comparison, which ask different questions of the
 * same shape: "what did this commit do" and "what differs between these two
 * points". Sharing it is what keeps the two from explaining the same limitation
 * in two different ways.
 */

const FILE_PAGE = 60;
const FILE_STEP = 120;
const MAX_PATCH_LINES = 320;
/** Lines shown before the diff box starts scrolling rather than growing. */
const PATCH_VIEWPORT_LINES = 18;

type Props = {
  files: FileChange[];
  /** True when the source could not return every file. */
  truncated?: boolean;
  /** What to say about the truncation, since the reason differs by source. */
  truncationNote?: string;
  /** Changes identity to collapse everything: a new commit, or a new comparison. */
  resetKey?: string;
  /**
   * A file to reveal and expand, set when the visitor arrived here by clicking
   * that file somewhere else. A fresh object identity means "do it again".
   */
  focus?: { path: string } | null;
  /** Called when a diff is opened, so playback can stop before it is read. */
  onOpenPatch?: () => void;
};

export function FileChangeList({
  files,
  truncated = false,
  truncationNote,
  resetKey = '',
  focus = null,
  onOpenPatch,
}: Props) {
  // Both bits of view state are keyed by `resetKey`, so moving to another commit
  // or comparison collapses them without an effect to reset anything.
  const [opened, setOpened] = useState<{ key: string; path: string } | null>(null);
  const [expanded, setExpanded] = useState<{ key: string; limit: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /*
   * A jump from elsewhere opens that file's diff.
   *
   * `focus` is a fresh object per jump, so comparing identity is what makes a
   * second jump to the same path work — and adjusting state from it here, in
   * render, is what keeps it out of an effect that would open the diff one
   * render later than the click that asked for it.
   */
  const [consumed, setConsumed] = useState<{ path: string } | null>(null);
  if (focus && focus !== consumed) {
    setConsumed(focus);
    setOpened({ key: resetKey, path: focus.path });
  }

  const openPath = opened && opened.key === resetKey ? opened.path : null;
  const limit = expanded && expanded.key === resetKey ? expanded.limit : FILE_PAGE;

  /*
   * A jump from the file tree has to survive the paging limit: the file it named
   * may sit past the first page, and opening a diff the visitor cannot see would
   * look like nothing happened.
   */
  const focusIndex = focus ? files.findIndex((file) => file.path === focus.path) : -1;
  const effectiveLimit = focusIndex >= limit ? focusIndex + 1 : limit;
  const shown = files.slice(0, effectiveLimit);

  useEffect(() => {
    if (!consumed) return;
    // Scrolling here is a direct consequence of the visitor's own click, which
    // is the only time this view moves itself.
    const row = listRef.current?.querySelector<HTMLElement>(`[data-path="${cssEscape(consumed.path)}"]`);
    // Guarded: not every environment implements it, and it is a nicety here.
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [consumed]);

  const toggle = (path: string) => {
    const closing = openPath === path;
    setOpened(closing ? null : { key: resetKey, path });
    if (!closing) onOpenPatch?.();
  };

  if (files.length === 0) return null;

  return (
    <>
      {truncated && truncationNote ? (
        <p className={styles.truncation} data-tone="warning">
          {truncationNote}
        </p>
      ) : null}

      <ul className={styles.fileList} ref={listRef}>
        {shown.map((file) => (
          <FileRow key={file.path} file={file} open={openPath === file.path} onToggle={toggle} />
        ))}
      </ul>

      {files.length > effectiveLimit ? (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setExpanded({ key: resetKey, limit: effectiveLimit + FILE_STEP })}
        >
          Show {formatNumber(Math.min(FILE_STEP, files.length - effectiveLimit))} more files
          <span className={styles.moreCount}>
            {formatNumber(effectiveLimit)} of {formatNumber(files.length)} shown
          </span>
        </button>
      ) : null}
    </>
  );
}

/** `CSS.escape` is not in jsdom, and the only hostile input here is a path. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function FileRow({ file, open, onToggle }: { file: FileChange; open: boolean; onToggle: (path: string) => void }) {
  const { dir, name } = splitPath(file.path);
  const panelId = `patch-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <li className={styles.fileItem} data-status={file.status} data-path={file.path}>
      <button
        type="button"
        className={styles.fileButton}
        onClick={() => onToggle(file.path)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {/* Status is a glyph, a colour and a word, so none of the three is load-bearing alone. */}
        <span className={styles.fileStatus} aria-hidden="true">
          {statusGlyph(file.status)}
        </span>
        <span className={styles.filePath}>
          <span className={styles.fileDir}>{dir}</span>
          <span className={styles.fileName}>{name}</span>
        </span>
        <span className={styles.fileStatusWord}>{statusWord(file.status)}</span>
        <span className={styles.fileNumbers}>
          {file.additions > 0 ? <span className={`${styles.plus} tabular`}>+{formatNumber(file.additions)}</span> : null}
          {file.deletions > 0 ? (
            <span className={`${styles.minus} tabular`}>&minus;{formatNumber(file.deletions)}</span>
          ) : null}
        </span>
        <span className={styles.fileChevron} aria-hidden="true">
          <ChevronIcon open={open} />
        </span>
      </button>

      {file.previousPath ? (
        <p className={styles.renamedFrom}>
          Renamed from <span className={styles.mono}>{file.previousPath}</span>
        </p>
      ) : null}

      <div id={panelId} hidden={!open}>
        {open ? file.patch !== null ? <Patch file={file} /> : <PatchFallback file={file} /> : null}
      </div>
    </li>
  );
}

export function statusGlyph(status: FileChange['status']): string {
  switch (status) {
    case 'added':
      return '+';
    case 'removed':
      return '−';
    case 'renamed':
      return '→';
    case 'copied':
      return '⧉';
    default:
      return '~';
  }
}

export function statusWord(status: FileChange['status']): string {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'unchanged':
      return 'unchanged';
    default:
      return 'modified';
  }
}

/**
 * Unified diff rendered as text.
 *
 * Every line is a React text node, so patch content from an arbitrary public
 * repository can never become markup.
 */
function Patch({ file }: { file: FileChange }) {
  const [full, setFull] = useState(false);
  const lines = useMemo(() => (file.patch ?? '').split('\n'), [file.patch]);
  const shown = lines.slice(0, MAX_PATCH_LINES);
  const tall = shown.length > PATCH_VIEWPORT_LINES;

  return (
    <div className={styles.patch}>
      {/* Only this box scrolls sideways; the page never does. */}
      <pre
        className={styles.patchPre}
        data-full={full || undefined}
        tabIndex={0}
        aria-label={`Diff for ${file.path}`}
      >
        <code>
          {shown.map((line, index) => (
            <span key={index} className={styles.patchLine} data-kind={lineKind(line)}>
              {line === '' ? ' ' : line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>

      {tall ? (
        <button type="button" className={styles.patchToggle} onClick={() => setFull((value) => !value)}>
          {full ? 'Collapse this diff' : `Expand all ${formatNumber(shown.length)} lines`}
        </button>
      ) : null}

      {lines.length > MAX_PATCH_LINES ? (
        <p className={styles.patchNote}>
          Showing the first {formatNumber(MAX_PATCH_LINES)} of {formatNumber(lines.length)} diff lines.{' '}
          {file.blobUrl ? (
            <a href={file.blobUrl} target="_blank" rel="noreferrer noopener">
              Open the file on GitHub
            </a>
          ) : null}
        </p>
      ) : file.patchTruncated ? (
        <p className={styles.patchNote}>
          This diff was cut short to keep the response small.{' '}
          {file.blobUrl ? (
            <a href={file.blobUrl} target="_blank" rel="noreferrer noopener">
              Open the file on GitHub
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What is here instead of a diff, and why.
 *
 * Each reason is a different fact about the source, so none of them is allowed
 * to collapse into "no changes" — which is the one thing they all are not.
 */
function PatchFallback({ file }: { file: FileChange }) {
  const reason =
    file.patchOmittedReason === 'binary'
      ? 'GitHub does not provide a text diff for this file: it is binary, or its content did not change.'
      : file.patchOmittedReason === 'too-large'
        ? 'GitHub omitted the diff for this file because it is too large.'
        : file.patchOmittedReason === 'aggregated'
          ? 'This file changed more than once between the two points, and this source cannot produce a single net diff for it. The line counts above are the totals across those changes, not the size of the net difference.'
          : 'This source did not provide a diff for this file. That is not the same as the file being unchanged.';

  return (
    <div className={styles.patchFallback} data-tone="warning">
      <p>{reason}</p>
      {file.blobUrl ? (
        <a href={file.blobUrl} target="_blank" rel="noreferrer noopener">
          View this file on GitHub
        </a>
      ) : null}
    </div>
  );
}

function lineKind(line: string): 'add' | 'del' | 'hunk' | 'meta' | 'ctx' {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none' }}
    >
      <path d="M1.5 3 5 6.5 8.5 3z" />
    </svg>
  );
}
