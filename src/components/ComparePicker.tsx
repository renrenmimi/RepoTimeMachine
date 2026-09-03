'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Commit, Tag } from '@/lib/domain/types';
import { formatDate, formatNumber } from '@/lib/format';
import styles from './compare-picker.module.css';

export type PickerChoice = {
  sha: string;
  /** Tag name when the visitor picked a tag, so the label can say so. */
  tagName: string | null;
};

type Props = {
  /** Which end of the comparison this picker sets. */
  side: 'base' | 'head';
  commits: Commit[];
  tags: Tag[];
  tagsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Currently selected sha, full or abbreviated. */
  selected: string | null;
  selectedLabel: string | null;
  disabled?: boolean;
  onPick: (choice: PickerChoice) => void;
};

/**
 * One end of a comparison: a tag, or any commit in the loaded range.
 *
 * The two ends carry equal weight and are named for what the visitor is doing —
 * From and To — with `base` and `head` in small print, because those words are
 * the answer to a question a newcomer has not asked yet.
 */
export function ComparePicker({
  side,
  commits,
  tags,
  tagsStatus,
  selected,
  selectedLabel,
  disabled = false,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const title = side === 'base' ? 'From' : 'To';

  // Tags that point somewhere inside the loaded range; the rest cannot be shown
  // on the timeline, so offering them would promise something we cannot keep.
  const usableTags = useMemo(() => {
    const inRange = new Set(commits.map((commit) => commit.sha));
    return tags.filter((tag) => inRange.has(tag.sha));
  }, [tags, commits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matchingTags = needle
      ? usableTags.filter((tag) => tag.name.toLowerCase().includes(needle))
      : usableTags;
    const matchingCommits = needle
      ? commits.filter(
          (commit) =>
            commit.subject.toLowerCase().includes(needle) ||
            commit.sha.startsWith(needle) ||
            commit.author.name.toLowerCase().includes(needle),
        )
      : commits;
    // Newest first: the end of a comparison is usually recent.
    return { tags: matchingTags, commits: [...matchingCommits].reverse().slice(0, 120) };
  }, [query, usableTags, commits]);

  const selectedCommit = useMemo(
    () => (selected ? commits.find((commit) => commit.sha.startsWith(selected)) : undefined),
    [commits, selected],
  );

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /**
   * Whether an option is the one currently chosen.
   *
   * `selected` may be a full sha or the abbreviation a shared link carries, so
   * the option's sha is matched by prefix. Nothing is selected when no choice has
   * been made yet, which has to be said explicitly: a sentinel string standing in
   * for "no selection" is how raw NUL bytes ended up in this file and made Git
   * treat it as binary.
   */
  const isSelected = (sha: string): boolean => selected !== null && sha.startsWith(selected);

  const choose = (choice: PickerChoice) => {
    onPick(choice);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={styles.picker} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerText}>
          <span className={styles.triggerLabel}>
            {title}
            {/* The Git word, kept as a hint rather than as the label. */}
            <span className={styles.triggerTerm}>{side}</span>
          </span>
          {selected ? (
            <>
              <span className={styles.triggerMain}>
                {selectedLabel ? (
                  <span className={styles.tagName}>
                    <TagIcon />
                    {selectedLabel}
                  </span>
                ) : (
                  (selectedCommit?.subject ?? 'Commit outside the loaded range')
                )}
              </span>
              <span className={styles.triggerMeta}>
                <span className={styles.mono}>{(selectedCommit?.sha ?? selected).slice(0, 7)}</span>
                {selectedCommit ? <span>{formatDate(selectedCommit.author.date)}</span> : null}
                {selectedCommit ? <span>#{selectedCommit.index + 1}</span> : null}
              </span>
            </>
          ) : (
            <span className={styles.triggerEmpty}>Choose a commit or tag</span>
          )}
        </span>
        <span className={styles.triggerChevron} aria-hidden="true">
          <ChevronIcon open={open} />
        </span>
      </button>

      {open ? (
        <div className={styles.menu} id={listId} role="dialog" aria-label={`Choose the ${side} of the comparison`}>
          <input
            ref={searchRef}
            className={styles.search}
            type="search"
            value={query}
            placeholder="Filter tags and commits…"
            aria-label={`Filter the ${side} choices`}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className={styles.scroll}>
            <p className={styles.group}>Tags</p>
            {/* A failed tag request is not a repository without tags. */}
            {tagsStatus === 'loading' || tagsStatus === 'idle' ? (
              <p className={styles.groupNote}>Loading tags…</p>
            ) : tagsStatus === 'error' ? (
              <p className={styles.groupNote} data-tone="warning">
                The tag list could not be loaded, so tags cannot be offered here. Commits below are unaffected.
              </p>
            ) : filtered.tags.length === 0 ? (
              <p className={styles.groupNote}>
                {usableTags.length === 0
                  ? 'This repository has no tags pointing inside the loaded range.'
                  : 'No tag matches the filter.'}
              </p>
            ) : (
              filtered.tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  className={styles.option}
                  data-selected={isSelected(tag.sha) || undefined}
                  onClick={() => choose({ sha: tag.sha, tagName: tag.name })}
                >
                  <span className={styles.optionMain}>
                    <TagIcon />
                    {tag.name}
                  </span>
                  <span className={styles.optionMeta}>
                    <span className={styles.mono}>{tag.sha.slice(0, 7)}</span>
                    {/* A tag is a ref, not evidence that anything was released. */}
                    <span>tag</span>
                  </span>
                </button>
              ))
            )}

            <p className={styles.group}>
              Commits
              {filtered.commits.length < commits.length ? (
                <span className={styles.groupCount}>
                  showing {formatNumber(filtered.commits.length)} of {formatNumber(commits.length)}
                </span>
              ) : null}
            </p>
            {filtered.commits.length === 0 ? (
              <p className={styles.groupNote}>Nothing in the loaded range matches.</p>
            ) : (
              filtered.commits.map((commit) => (
                <button
                  key={commit.sha}
                  type="button"
                  className={styles.option}
                  data-selected={isSelected(commit.sha) || undefined}
                  onClick={() => choose({ sha: commit.sha, tagName: null })}
                >
                  <span className={styles.optionMain}>{commit.subject}</span>
                  <span className={styles.optionMeta}>
                    <span className={styles.mono}>{commit.shortSha}</span>
                    <span>#{commit.index + 1}</span>
                    <span>{formatDate(commit.author.date)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none' }}
    >
      <path d="M1.5 3 5 6.5 8.5 3z" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M5.2 1H9v3.8L4.8 9 1 5.2z" strokeLinejoin="round" />
      <circle cx="7" cy="3" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
