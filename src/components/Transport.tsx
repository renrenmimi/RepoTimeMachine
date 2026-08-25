'use client';

import { useMemo } from 'react';
import type { Commit } from '@/lib/domain/types';
import type { Milestone } from '@/lib/milestones/detect';
import { SPEEDS, type PlaybackState, type Speed } from '@/lib/playback/machine';
import { formatDate, formatNumber } from '@/lib/format';
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
  disabled: boolean;
};

const TICK_BUDGET = 260;

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
  disabled,
}: Props) {
  const count = commits.length;
  const max = Math.max(0, count - 1);
  const position = max === 0 ? 0 : playback.index / max;
  const current = commits[playback.index] ?? null;

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
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={onPrevious}
            disabled={disabled || playback.index === 0}
            aria-label="Previous commit"
            title="Previous commit (Left arrow)"
          >
            <PrevIcon />
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.play}`}
            onClick={onPlayPause}
            disabled={disabled || count <= 1}
            aria-label={playback.playing ? 'Pause playback' : 'Play history'}
            aria-pressed={playback.playing}
            title={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playback.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={onNext}
            disabled={disabled || playback.index >= max}
            aria-label="Next commit"
            title="Next commit (Right arrow)"
          >
            <NextIcon />
          </button>
        </div>

        <div className={styles.readout}>
          <span className={`${styles.position} tabular`}>
            {count === 0 ? '—' : `${formatNumber(playback.index + 1)} / ${formatNumber(count)}`}
          </span>
          <span className={styles.readoutDate}>{current ? formatDate(current.author.date) : 'no commits loaded'}</span>
        </div>

        <div className={styles.speed} role="group" aria-label="Playback speed">
          <span className={styles.speedLabel} aria-hidden="true">
            speed
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
        <div className={styles.milestoneRow} aria-hidden="true">
          {milestoneMarks.map((mark) => (
            <button
              key={mark.index}
              type="button"
              className={styles.milestoneMark}
              data-approximate={mark.approximate || undefined}
              style={{ left: `${mark.offset * 100}%` }}
              tabIndex={-1}
              onClick={() => onSeek(mark.index)}
              title={
                mark.approximate
                  ? `${mark.items.map((item) => item.label).join(' · ')} — somewhere at or after commit ${mark.index + 1}`
                  : `${mark.items.map((item) => item.label).join(' · ')} — commit ${mark.index + 1}`
              }
            />
          ))}
        </div>

        <div className={styles.track}>
          <svg className={styles.ticks} viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="12" x2="1000" y2="12" className={styles.baseline} />
            {ticks.map((offset, index) => (
              <line
                key={index}
                x1={offset * 1000}
                x2={offset * 1000}
                y1={index % 10 === 0 ? 4 : 7}
                y2={index % 10 === 0 ? 20 : 17}
                className={styles.tick}
              />
            ))}
          </svg>

          <div className={styles.progress} style={{ width: `${position * 100}%` }} aria-hidden="true" />
          <div className={styles.playhead} style={{ left: `${position * 100}%` }} aria-hidden="true">
            <span className={styles.playheadStem} />
            <span className={styles.playheadKnob} />
          </div>

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

        <div className={styles.scale}>
          <span>{commits[0] ? formatDate(commits[0].author.date) : ''}</span>
          <span className={styles.rangeLabel}>{rangeLabel}</span>
          <span>{commits[max] ? formatDate(commits[max]!.author.date) : ''}</span>
        </div>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 1.5 12 7l-9 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
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
