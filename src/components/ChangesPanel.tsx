'use client';

import type { CommitDetail } from '@/lib/domain/types';
import { formatNumber } from '@/lib/format';
import { FileChangeList, type OpenedDiff } from './FileChangeList';
import styles from './changes-panel.module.css';

type Props = {
  detail: CommitDetail | null;
  pending: boolean;
  /** True while playback is running, which explains a diff that is not here yet. */
  playing: boolean;
  /** A file to reveal and expand, set by a jump from the file tree. */
  focus: { path: string } | null;
  onOpenPatch: () => void;
  /** Owned by the shell, so a diff left open survives a trip to another view. */
  opened: OpenedDiff | null;
  onOpened: (opened: OpenedDiff | null) => void;
  className?: string;
};

/**
 * What the selected commit changed.
 *
 * Only the changes: the commit's own identity is in the header above, shared
 * with the file tree, so moving between the two sub-views never re-reads a
 * heading or loses the place.
 */
export function ChangesPanel({
  detail,
  pending,
  playing,
  focus,
  onOpenPatch,
  opened,
  onOpened,
  className,
}: Props) {
  if (!detail) {
    return (
      <section className={`${styles.panel} ${className ?? ''}`} aria-label="Files changed by this commit">
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            {pending ? 'Loading this commit’s diff…' : 'This commit’s diff has not loaded'}
          </p>
          <p className={styles.emptyText}>
            {pending
              ? 'One request per commit, and this one is in flight.'
              : playing
                ? 'Diffs load as playback passes each commit. Pause here and it will arrive.'
                : 'It has not been requested yet, or the request did not succeed. The commit details above are unaffected.'}
          </p>
        </div>
      </section>
    );
  }

  if (detail.files.length === 0) {
    return (
      <section className={`${styles.panel} ${className ?? ''}`} aria-label="Files changed by this commit">
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>This commit changed no files</p>
          <p className={styles.emptyText}>
            {/* A real thing that happens: empty commits, and merges with no net change. */}
            The source reports no file difference for it — an empty commit, or a merge that introduced nothing new.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${className ?? ''}`} aria-label="Files changed by this commit">
      <h3 className="visually-hidden">
        {formatNumber(detail.changedFiles)} file{detail.changedFiles === 1 ? '' : 's'} changed
      </h3>

      <FileChangeList
        files={detail.files}
        truncated={detail.filesTruncated}
        truncationNote="GitHub returns at most 300 files per commit, so this list may be incomplete."
        resetKey={detail.sha}
        focus={focus}
        onOpenPatch={onOpenPatch}
        opened={opened}
        onOpened={onOpened}
      />
    </section>
  );
}
