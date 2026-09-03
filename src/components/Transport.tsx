'use client';

import { useMemo } from 'react';
import type { Commit } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import { isAtEnd, SPEEDS, type PlaybackState, type Speed } from '@/lib/playback/machine';
import { formatDate } from '@/lib/format';
import styles from './transport.module.css';

type Props = {
  playback: PlaybackState;
  commits: Commit[];
  milestones: Milestone[];
  /** Honest description of what is loaded, e.g. "latest 300 of 1,204 commits". */
  rangeLabel: string;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (index: number) => void;
  onSpeed: (speed: Speed) => void;
  onLatest: () => void;
  disabled: boolean;
};

const TICK_BUDGET = 260;

/**
 * One row of controls and a thin track.
 *
 * The whole point of compressing this is that the controls and the thing they
 * control have to be on screen together: a player whose position bar pushes the
 * file tree below the fold is not a player.
 */
export function Transport({
  playback,
  commits,
  milestones,
  rangeLabel,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onSpeed,
  onLatest,
  disabled,
}: Props) {
  const count = commits.length;
  const max = Math.max(0, count - 1);
  const position = max === 0 ? 0 : playback.index / max;
  const current = commits[playback.index] ?? null;
  const single = count <= 1;

  /*
   * At the last commit the button restarts from the beginning, which is what
   * the reducer does — so it says so, rather than being disabled with no
   * explanation of why.
   */
  const atEnd = !playback.playing && isAtEnd(playback) && count > 1;
  const playLabel = playback.playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
  const playName = playback.playing
    ? 'Pause playback'
    : atEnd
      ? 'Replay the history from the first loaded commit'
      : 'Play history';

  const ticks = useMemo(() => {
    if (count === 0) return [];
    if (count <= TICK_BUDGET) return commits.map((_, index) => index / Math.max(1, max));
    // Too many commits to draw one line each; sample evenly instead of lying
    // about density.
    return Array.from({ length: TICK_BUDGET }, (_, i) => i / (TICK_BUDGET - 1));
  }, [commits, count, max]);

  const milestoneMarks = useMemo(() => {
    const byIndex = new Map<number, Milestone[]>();
    for (const milestone of milestones) {
      const list = byIndex.get(milestone.commitIndex) ?? [];
      list.push(milestone);
      byIndex.set(milestone.commitIndex, list);
    }
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, items]) => ({
        index,
        offset: max === 0 ? 0 : index / max,
        items,
        // A group that is only an approximate position is drawn faintly.
        approximate: items.every((item) => item.confidence === 'window'),
      }));
  }, [milestones, max]);

  return (
    <section className={styles.transport} aria-label="Playback controls">
      <div className={styles.row}>
        <button
          type="button"
          className={styles.step}
          onClick={onPrevious}
          disabled={disabled || playback.index === 0}
          aria-label="Previous commit"
          title="Previous commit (Left arrow)"
        >
          <PrevIcon />
        </button>

        <button
          type="button"
          className={styles.play}
          onClick={onPlayPause}
          disabled={disabled || single}
          aria-label={playName}
          aria-pressed={playback.playing}
          title={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playback.playing ? <PauseIcon /> : <PlayIcon />}
          <span className={styles.playLabel}>{playLabel}</span>
        </button>

        <button
          type="button"
          className={styles.step}
          onClick={onNext}
          disabled={disabled || playback.index >= max}
          aria-label="Next commit"
          title="Next commit (Right arrow)"
        >
          <NextIcon />
        </button>

        {/* The position and the date are stated once, in the heading directly
            above this row; repeating them here would only be noise. */}
        <button
          type="button"
          className={styles.latest}
          onClick={onLatest}
          disabled={disabled || playback.index >= max}
          title="Jump to the newest commit in the loaded range"
        >
          Latest
        </button>

        <div className={styles.speed} role="group" aria-label="Playback speed">
          <span className={styles.speedLabel} aria-hidden="true">
            Speed
          </span>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={styles.speedButton}
              data-active={playback.speed === speed || undefined}
              aria-pressed={playback.speed === speed}
              onClick={() => onSpeed(speed)}
              disabled={disabled}
            >
              {speed}
              <span aria-hidden="true">×</span>
              <span className="visually-hidden"> speed</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.trackArea}>
        <div className={styles.track}>
          <svg className={styles.ticks} viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true">
            {ticks.map((offset, index) => (
              <line
                key={index}
                x1={offset * 1000}
                x2={offset * 1000}
                y1={index % 10 === 0 ? 2 : 4}
                y2={index % 10 === 0 ? 10 : 8}
                className={styles.tick}
              />
            ))}
          </svg>

          <div className={styles.progress} style={{ width: `${position * 100}%` }} aria-hidden="true" />

          {milestoneMarks.map((mark) => (
            <span
              key={mark.index}
              className={styles.milestoneMark}
              data-approximate={mark.approximate || undefined}
              style={{ left: `${mark.offset * 100}%` }}
              aria-hidden="true"
              title={
                mark.approximate
                  ? `${mark.items.map((item) => item.label).join(' · ')} — somewhere at or after commit ${mark.index + 1}`
                  : `${mark.items.map((item) => item.label).join(' · ')} — commit ${mark.index + 1}`
              }
            />
          ))}

          <div className={styles.playhead} style={{ left: `${position * 100}%` }} aria-hidden="true" />

          <input
            className={styles.range}
            type="range"
            min={0}
            max={max}
            step={1}
            value={playback.index}
            disabled={disabled || count === 0}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="Commit position in the loaded history"
            aria-valuetext={
              current
                ? `Commit ${playback.index + 1} of ${count}, ${formatDate(current.author.date)}, ${current.subject}`
                : 'No commits loaded'
            }
          />
        </div>

        <p className={styles.scale}>
          <span>{commits[0] ? formatDate(commits[0].author.date) : ''}</span>
          <span className={styles.rangeLabel}>{rangeLabel}</span>
          <span>{commits[max] ? formatDate(commits[max]!.author.date) : ''}</span>
        </p>
      </div>

      {single ? (
        <p className={styles.singleNote}>
          There is one commit in this range, so there is nothing to play through.
        </p>
      ) : null}
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 1.5 12 7l-9 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2" width="3" height="10" rx="0.5" />
      <rect x="8" y="2" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M11 2 4.5 7 11 12z" />
      <rect x="2" y="2" width="1.8" height="10" rx="0.5" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 2 9.5 7 3 12z" />
      <rect x="10.2" y="2" width="1.8" height="10" rx="0.5" />
    </svg>
  );
}
