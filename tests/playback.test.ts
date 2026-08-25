import { describe, expect, it } from 'vitest';
import {
  BASE_STEP_MS,
  MIN_STEP_MS,
  initialPlaybackState,
  isAtEnd,
  isSpeed,
  nextSpeed,
  playbackReducer,
  stepMs,
  type PlaybackState,
} from '@/lib/playback/machine';

const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  ...initialPlaybackState(10, 0),
  ...overrides,
});

describe('play and pause', () => {
  it('starts playing from a stopped state', () => {
    expect(playbackReducer(state(), { type: 'play' }).playing).toBe(true);
  });

  it('pauses at any point without moving the playhead', () => {
    const playing = state({ index: 4, playing: true });
    const paused = playbackReducer(playing, { type: 'pause' });
    expect(paused.playing).toBe(false);
    expect(paused.index).toBe(4);
  });

  it('resumes from where it paused', () => {
    const resumed = playbackReducer(state({ index: 4, playing: false }), { type: 'play' });
    expect(resumed).toMatchObject({ index: 4, playing: true });
  });

  it('toggles both ways', () => {
    const on = playbackReducer(state(), { type: 'toggle' });
    expect(on.playing).toBe(true);
    expect(playbackReducer(on, { type: 'toggle' }).playing).toBe(false);
  });

  it('restarts from the beginning when play is pressed at the end', () => {
    const restarted = playbackReducer(state({ index: 9, playing: false }), { type: 'play' });
    expect(restarted).toMatchObject({ index: 0, playing: true });
  });

  it('refuses to play a single-commit range', () => {
    expect(playbackReducer(initialPlaybackState(1, 0), { type: 'play' }).playing).toBe(false);
  });

  it('refuses to play an empty range', () => {
    expect(playbackReducer(initialPlaybackState(0, 0), { type: 'play' }).playing).toBe(false);
  });

  it('returns the identical object when pausing an already paused timeline', () => {
    const paused = state({ playing: false });
    expect(playbackReducer(paused, { type: 'pause' })).toBe(paused);
  });
});

describe('stepping', () => {
  it('moves forward and backward', () => {
    expect(playbackReducer(state({ index: 3 }), { type: 'next' }).index).toBe(4);
    expect(playbackReducer(state({ index: 3 }), { type: 'previous' }).index).toBe(2);
  });

  it('clamps at both ends', () => {
    expect(playbackReducer(state({ index: 9 }), { type: 'next' }).index).toBe(9);
    expect(playbackReducer(state({ index: 0 }), { type: 'previous' }).index).toBe(0);
  });

  it('stops playback when stepping forward lands on the last commit', () => {
    const stepped = playbackReducer(state({ index: 8, playing: true }), { type: 'next' });
    expect(stepped).toMatchObject({ index: 9, playing: false });
  });

  it('treats stepping backwards as a deliberate pause', () => {
    expect(playbackReducer(state({ index: 5, playing: true }), { type: 'previous' }).playing).toBe(false);
  });

  it('jumps to the first and last commit', () => {
    expect(playbackReducer(state({ index: 5 }), { type: 'first' })).toMatchObject({ index: 0, playing: false });
    expect(playbackReducer(state({ index: 5 }), { type: 'last' })).toMatchObject({ index: 9, playing: false });
  });
});

describe('seeking', () => {
  it('moves to an arbitrary index and pauses', () => {
    expect(playbackReducer(state({ playing: true }), { type: 'seek', index: 7 })).toMatchObject({
      index: 7,
      playing: false,
    });
  });

  it('clamps out-of-range and non-finite targets', () => {
    expect(playbackReducer(state(), { type: 'seek', index: 99 }).index).toBe(9);
    expect(playbackReducer(state(), { type: 'seek', index: -3 }).index).toBe(0);
    expect(playbackReducer(state({ index: 4 }), { type: 'seek', index: Number.NaN }).index).toBe(0);
  });

  it('rounds a fractional target', () => {
    expect(playbackReducer(state(), { type: 'seek', index: 3.6 }).index).toBe(4);
  });

  it('is a no-op when seeking to the current index', () => {
    const current = state({ index: 4, playing: true });
    expect(playbackReducer(current, { type: 'seek', index: 4 })).toBe(current);
  });
});

describe('speed', () => {
  it('changes speed without touching position or play state', () => {
    const playing = state({ index: 6, playing: true, speed: 1 });
    const faster = playbackReducer(playing, { type: 'setSpeed', speed: 4 });
    expect(faster).toMatchObject({ index: 6, playing: true, speed: 4 });
  });

  it('is a no-op when the speed is already selected', () => {
    const current = state({ speed: 2 });
    expect(playbackReducer(current, { type: 'setSpeed', speed: 2 })).toBe(current);
  });

  it('maps speed to a step interval, with a floor', () => {
    expect(stepMs(1)).toBe(BASE_STEP_MS);
    expect(stepMs(2)).toBe(Math.round(BASE_STEP_MS / 2));
    expect(stepMs(0.5)).toBe(BASE_STEP_MS * 2);
    expect(stepMs(8)).toBeGreaterThanOrEqual(MIN_STEP_MS);
  });

  it('walks the speed ladder and clamps at both ends', () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(1, -1)).toBe(0.5);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
    expect(nextSpeed(8, 1)).toBe(8);
  });

  it('recognises only the offered speeds', () => {
    expect(isSpeed(4)).toBe(true);
    expect(isSpeed(3)).toBe(false);
    expect(isSpeed('2')).toBe(false);
  });
});

describe('ticking', () => {
  it('advances one commit per tick while playing', () => {
    let current = state({ index: 0, playing: true });
    for (let i = 0; i < 5; i += 1) current = playbackReducer(current, { type: 'tick' });
    expect(current.index).toBe(5);
    expect(current.playing).toBe(true);
  });

  it('stops at the end instead of wrapping', () => {
    const ended = playbackReducer(state({ index: 8, playing: true }), { type: 'tick' });
    expect(ended).toMatchObject({ index: 9, playing: false });
  });

  it('does nothing when paused', () => {
    const paused = state({ index: 3, playing: false });
    expect(playbackReducer(paused, { type: 'tick' })).toBe(paused);
  });
});

describe('range changes', () => {
  it('keeps the requested index when the range grows', () => {
    const grown = playbackReducer(state({ index: 4 }), { type: 'setCount', count: 110, index: 104 });
    expect(grown).toMatchObject({ count: 110, index: 104 });
  });

  it('clamps the playhead when the range shrinks', () => {
    expect(playbackReducer(state({ index: 9 }), { type: 'setCount', count: 3 }).index).toBe(2);
  });

  it('stops playback when the new range has nothing to play', () => {
    expect(playbackReducer(state({ playing: true }), { type: 'setCount', count: 0 })).toMatchObject({
      count: 0,
      index: 0,
      playing: false,
    });
  });

  it('returns the identical object when nothing actually changes', () => {
    const current = state({ index: 4 });
    expect(playbackReducer(current, { type: 'setCount', count: 10, index: 4 })).toBe(current);
  });
});

describe('isAtEnd', () => {
  it('is true at the last commit and for an empty range', () => {
    expect(isAtEnd(state({ index: 9 }))).toBe(true);
    expect(isAtEnd(initialPlaybackState(0))).toBe(true);
    expect(isAtEnd(state({ index: 8 }))).toBe(false);
  });
});

describe('initialPlaybackState', () => {
  it('starts paused at 1x and clamps the requested index', () => {
    expect(initialPlaybackState(5, 99)).toEqual({ index: 4, playing: false, speed: 1, count: 5 });
    expect(initialPlaybackState()).toEqual({ index: 0, playing: false, speed: 1, count: 0 });
  });
});
