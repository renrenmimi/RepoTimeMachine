'use client';

import { useMemo, useState } from 'react';
import type { FileChange } from '@/lib/domain/types';
import { formatNumber, splitPath } from '@/lib/format';
import styles from './commit-panel.module.css';

/**
 * A list of changed files, each expandable to its diff.
 *
 * Shared by the commit view and the comparison view, which ask different
 * questions of the same shape: "what did this commit do" and "what differs
 * between these two points".
 */

const FILE_PAGE = 60;
const FILE_STEP = 120;
const MAX_PATCH_LINES = 320;

type Props = {
  files: FileChange[];
  /** True when the source could not return every file. */
  truncated?: boolean;
  /** What to say about the truncation, since the reason differs by source. */
  truncationNote?: string;
  /** Changes identity to collapse everything: a new commit, or a new comparison. */
  resetKey?: string;
};

export function FileChangeList({ files, truncated = false, truncationNote, resetKey = '' }: Props) {
  // Both bits of view state are keyed by `resetKey`, so moving to another commit
  // or comparison collapses them without an effect to reset anything.
  const [opened, setOpened] = useState<{ key: string; path: string } | null>(null);
  const [expanded, setExpanded] = useState<{ key: string; limit: number } | null>(null);

  const openPath = opened && opened.key === resetKey ? opened.path : null;
  const limit = expanded && expanded.key === resetKey ? expanded.limit : FILE_PAGE;
  const shown = files.slice(0, limit);

  const toggle = (path: string) =>
    setOpened((current) =>
      current && current.key === resetKey && current.path === path ? null : { key: resetKey, path },
    );

  return (
    <>
      {truncated && truncationNote ? <p className={styles.truncation}>{truncationNote}</p> : null}

      <ul className={styles.fileList}>
        {shown.map((file) => (
          <FileRow key={file.path} file={file} open={openPath === file.path} onToggle={toggle} />
        ))}
      </ul>

      {files.length > limit ? (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setExpanded({ key: resetKey, limit: limit + FILE_STEP })}
        >
          Show {Math.min(FILE_STEP, files.length - limit)} more files
        </button>
      ) : null}
    </>
  );
}

function FileRow({ file, open, onToggle }: { file: FileChange; open: boolean; onToggle: (path: string) => void }) {
  const { dir, name } = splitPath(file.path);
  const panelId = `patch-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <li className={styles.fileItem} data-status={file.status}>
      <button
        type="button"
        className={styles.fileButton}
        onClick={() => onToggle(file.path)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={styles.fileStatus} aria-hidden="true">
          {statusGlyph(file.status)}
        </span>
        <span className={styles.filePath}>
          <span className={styles.fileDir}>{dir}</span>
          <span className={styles.fileName}>{name}</span>
        </span>
        <span className={styles.fileNumbers}>
          {file.additions > 0 ? <span className={`${styles.plus} tabular`}>+{formatNumber(file.additions)}</span> : null}
          {file.deletions > 0 ? (
            <span className={`${styles.minus} tabular`}>&minus;{formatNumber(file.deletions)}</span>
          ) : null}
        </span>
        <span className="visually-hidden">{file.status}</span>
      </button>

      {file.previousPath ? (
        <p className={styles.renamedFrom}>
          renamed from <span className={styles.mono}>{file.previousPath}</span>
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

/**
 * Unified diff rendered as text.
 *
 * Every line is a React text node, so patch content from an arbitrary public
 * repository can never become markup.
 */
function Patch({ file }: { file: FileChange }) {
  const lines = useMemo(() => (file.patch ?? '').split('\n'), [file.patch]);
  const shown = lines.slice(0, MAX_PATCH_LINES);

  return (
    <div className={styles.patch}>
      <pre className={styles.patchPre} tabIndex={0} aria-label={`Diff for ${file.path}`}>
        <code>
          {shown.map((line, index) => (
            <span key={index} className={styles.patchLine} data-kind={lineKind(line)}>
              {line === '' ? ' ' : line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      {lines.length > MAX_PATCH_LINES ? (
        <p className={styles.patchNote}>
          Showing the first {MAX_PATCH_LINES} lines of this diff.{' '}
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

function PatchFallback({ file }: { file: FileChange }) {
  const reason =
    file.patchOmittedReason === 'binary'
      ? 'GitHub does not provide a text diff for this file: it is binary or has no textual change.'
      : file.patchOmittedReason === 'too-large'
        ? 'GitHub omitted the diff for this file because it is too large.'
        : file.patchOmittedReason === 'aggregated'
          ? 'This file changed more than once between the two points, so no single diff describes the net difference. The line counts above are the totals across those changes.'
          : 'No diff was provided for this file.';

  return (
    <div className={styles.patchFallback}>
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
