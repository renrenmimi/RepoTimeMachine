'use client';

import { useState } from 'react';

import type { Commit, CommitDetail } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import { formatDateTime, formatGap, formatNumber } from '@/lib/format';
import { FileChangeList } from './FileChangeList';
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
        {/* Built-in commits have no real URL, so there is nothing to link to and
            no "view on GitHub" affordance is shown. */}
        {commit.htmlUrl ? (
          <a className={styles.shaLink} href={commit.htmlUrl} target="_blank" rel="noreferrer noopener">
            {commit.shortSha}
            <ExternalIcon />
          </a>
        ) : (
          <span className={styles.shaPlain} title="Built-in demo commit; there is no repository to open.">
            {commit.shortSha}
          </span>
        )}
      </header>

      <div className={shell.panelBody}>
        <div className={styles.head}>
          <h3 className={styles.subject} id="selected-commit-subject">
            {commit.subject}
          </h3>

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

        <FileChanges detail={detail} pending={detailPending} playing={playing} />
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
  playing: boolean;
};

function FileChanges({ detail, pending, playing }: FileChangesProps) {
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

  return (
    <div className={styles.changes}>
      <div className={styles.changesHead}>
        <h4 className={styles.changesTitle}>Files changed</h4>
        <span className={styles.changesStats}>
          <span className={`${styles.statFiles} tabular`}>{formatNumber(detail.changedFiles)}</span>
          <span className={`${styles.plus} tabular`}>+{formatNumber(detail.additions)}</span>
          <span className={`${styles.minus} tabular`}>&minus;{formatNumber(detail.deletions)}</span>
        </span>
      </div>

      <FileChangeList
        files={detail.files}
        truncated={detail.filesTruncated}
        truncationNote="GitHub returns at most 300 files per commit, so this list may be incomplete."
        resetKey={detail.sha}
      />
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M3.5 1.5H1.5v7h7v-2" strokeLinecap="round" />
      <path d="M6 1.5h2.5V4M8.5 1.5 4.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
