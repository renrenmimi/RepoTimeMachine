'use client';

import { useMemo, useState } from 'react';
import type { Commit, CommitDetail, FileChange } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import { formatDateTime, formatGap, formatNumber, splitPath } from '@/lib/format';
import styles from './commit-panel.module.css';
import shell from './shell.module.css';

type Props = {
  commit: Commit | null;
  previous: Commit | null;
  detail: CommitDetail | null;
  detailPending: boolean;
  milestones: Milestone[];
  /** True while playback is running: patches stay collapsed so the view is calm. */
  playing: boolean;
  className?: string;
};

export function CommitPanel({ commit, previous, detail, detailPending, milestones, playing, className }: Props) {
  // The open patch is remembered per commit, so moving along the timeline
  // closes it without needing an effect to reset anything.
  const [opened, setOpened] = useState<{ sha: string; path: string } | null>(null);
  const openPath = opened && opened.sha === commit?.sha ? opened.path : null;

  if (!commit) {
    return (
      <section className={`${shell.panel} ${styles.panel} ${className ?? ''}`} aria-labelledby="commit-heading">
        <header className={shell.panelHead}>
          <h2 className={shell.panelTitle} id="commit-heading">
            Commit
          </h2>
        </header>
        <div className={shell.panelBody}>
          <p className={styles.placeholder}>No commit selected.</p>
        </div>
      </section>
    );
  }

  const gap = previous ? formatGap(previous.author.date, commit.author.date) : null;

  return (
    <section className={`${shell.panel} ${styles.panel} ${className ?? ''}`} aria-labelledby="commit-heading">
      <header className={shell.panelHead}>
        <h2 className={shell.panelTitle} id="commit-heading">
          Commit
        </h2>
        <span className={shell.panelHeadSpacer} />
        <a className={styles.shaLink} href={commit.htmlUrl} target="_blank" rel="noreferrer noopener">
          {commit.shortSha}
          <ExternalIcon />
        </a>
      </header>

      <div className={shell.panelBody}>
        <div className={styles.head}>
          <h3 className={styles.subject}>{commit.subject}</h3>

          <p className={styles.meta}>
            <span className={styles.author}>{commit.author.name}</span>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <time dateTime={commit.author.date}>{formatDateTime(commit.author.date)}</time>
            {gap ? (
              <>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.gap}>{gap}</span>
              </>
            ) : null}
          </p>

          {commit.body ? <CommitBody body={commit.body} /> : null}

          {milestones.length > 0 ? (
            <ul className={styles.milestones}>
              {milestones.map((milestone) => (
                <li key={milestone.id} className={styles.milestone} data-kind={milestone.kind}>
                  <p className={styles.milestoneLabel}>
                    {milestone.label}
                    <ConfidenceTag milestone={milestone} />
                  </p>
                  <p className={styles.milestoneEvidence}>{milestone.evidence}</p>
                  <p className={styles.milestoneRule}>Rule: {milestone.rule}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <FileChanges
          detail={detail}
          pending={detailPending}
          openPath={openPath}
          onToggle={(path) =>
            setOpened((current) =>
              current && current.sha === commit.sha && current.path === path
                ? null
                : { sha: commit.sha, path },
            )
          }
          playing={playing}
        />
      </div>
    </section>
  );
}

function ConfidenceTag({ milestone }: { milestone: Milestone }) {
  if (milestone.confidence === 'window' && milestone.window) {
    return (
      <span className={styles.confidence} data-level="window">
        narrowed to commits {milestone.window.fromIndex + 1}–{milestone.window.toIndex + 1}
      </span>
    );
  }
  if (milestone.confidence === 'probed') {
    return (
      <span className={styles.confidence} data-level="probed">
        confirmed by path history
      </span>
    );
  }
  return null;
}

const BODY_PREVIEW_LINES = 5;
const BODY_MAX_CHARS = 4000;

/** Long commit bodies are collapsed so the file list stays above the fold. */
function CommitBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}…` : body;
  const lines = text.split('\n');
  const long = lines.length > BODY_PREVIEW_LINES;
  const shown = expanded || !long ? text : lines.slice(0, BODY_PREVIEW_LINES).join('\n');

  return (
    <div className={styles.bodyWrap}>
      <p className={styles.body}>{shown}</p>
      {long ? (
        <button type="button" className={styles.bodyToggle} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
}

type FileChangesProps = {
  detail: CommitDetail | null;
  pending: boolean;
  openPath: string | null;
  onToggle: (path: string) => void;
  playing: boolean;
};

const FILE_PAGE = 60;

function FileChanges({ detail, pending, openPath, onToggle, playing }: FileChangesProps) {
  // Also keyed by sha: a longer list asked for on one commit does not carry over.
  const [expandedFor, setExpandedFor] = useState<{ sha: string; limit: number } | null>(null);
  const limit = expandedFor && expandedFor.sha === detail?.sha ? expandedFor.limit : FILE_PAGE;

  if (!detail) {
    return (
      <div className={styles.changes}>
        <div className={styles.changesHead}>
          <h4 className={styles.changesTitle}>Files changed</h4>
        </div>
        <p className={styles.placeholder}>
          {pending
            ? 'Loading this commit’s diff…'
            : playing
              ? 'Diffs load as playback passes each commit.'
              : 'This commit’s diff has not been loaded.'}
        </p>
      </div>
    );
  }

  const files = detail.files.slice(0, limit);

  return (
    <div className={styles.changes}>
      <div className={styles.changesHead}>
        <h4 className={styles.changesTitle}>Files changed</h4>
        <span className={styles.changesStats}>
          <span className={`${styles.statFiles} tabular`}>{formatNumber(detail.changedFiles)}</span>
          <span className={`${styles.plus} tabular`}>+{formatNumber(detail.additions)}</span>
          <span className={`${styles.minus} tabular`}>−{formatNumber(detail.deletions)}</span>
        </span>
      </div>

      {detail.filesTruncated ? (
        <p className={styles.truncation}>
          GitHub returns at most 300 files per commit, so this list may be incomplete.
        </p>
      ) : null}

      <ul className={styles.fileList}>
        {files.map((file) => (
          <FileRow key={file.path} file={file} open={openPath === file.path} onToggle={onToggle} />
        ))}
      </ul>

      {detail.files.length > limit ? (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setExpandedFor({ sha: detail.sha, limit: limit + 120 })}
        >
          Show {Math.min(120, detail.files.length - limit)} more files
        </button>
      ) : null}
    </div>
  );
}

function FileRow({ file, open, onToggle }: { file: FileChange; open: boolean; onToggle: (path: string) => void }) {
  const { dir, name } = splitPath(file.path);
  const hasPatch = file.patch !== null;
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
          {file.additions > 0 ? <span className={`${styles.plus} tabular`}>+{file.additions}</span> : null}
          {file.deletions > 0 ? <span className={`${styles.minus} tabular`}>−{file.deletions}</span> : null}
        </span>
        <span className="visually-hidden">{file.status}</span>
      </button>

      {file.previousPath ? (
        <p className={styles.renamedFrom}>
          renamed from <span className={styles.mono}>{file.previousPath}</span>
        </p>
      ) : null}

      <div id={panelId} hidden={!open}>
        {open ? hasPatch ? <Patch file={file} /> : <PatchFallback file={file} /> : null}
      </div>
    </li>
  );
}

function statusGlyph(status: FileChange['status']): string {
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

const MAX_PATCH_LINES = 320;

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

function ExternalIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3.5 1.5H1.5v7h7v-2" strokeLinecap="round" />
      <path d="M6 1.5h2.5V4M8.5 1.5 4.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
