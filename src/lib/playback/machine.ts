/**
 * Pure playback reducer. Kept free of React and timers so the interaction rules
 * ("changing speed must not reset the timeline", "playback stops at the end")
 * can be tested directly.
 */

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

/** Milliseconds spent on one commit at 1×. */
export const BASE_STEP_MS = 850;
/** Never step faster than this, so the UI stays readable at 8×. */
export const MIN_STEP_MS = 90;

export type PlaybackState = {
  /** Index of the selected commit, 0 = oldest loaded. */
  index: number;
  playing: boolean;
  speed: Speed;
  /** Number of commits in the loaded range. */
  count: number;
};

export type PlaybackAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'seek'; index: number }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setCount'; count: number; index?: number }
  | { type: 'tick' };

export function initialPlaybackState(count = 0, index = 0): PlaybackState {
  return { index: clamp(index, count), playing: false, speed: 1, count };
}

function clamp(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}

export function stepMs(speed: Speed): number {
  return Math.max(MIN_STEP_MS, Math.round(BASE_STEP_MS / speed));
}

export function isAtEnd(state: PlaybackState): boolean {
  return state.count === 0 || state.index >= state.count - 1;
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'play': {
      if (state.count <= 1) return { ...state, playing: false };
      // Pressing play at the very end restarts from the beginning.
      if (isAtEnd(state)) return { ...state, index: 0, playing: true };
      return { ...state, playing: true };
    }
    case 'pause':
      return state.playing ? { ...state, playing: false } : state;
    case 'toggle':
      return playbackReducer(state, { type: state.playing ? 'pause' : 'play' });
    case 'next': {
      const index = clamp(state.index + 1, state.count);
      return { ...state, index, playing: state.playing && index < state.count - 1 };
    }
    case 'previous':
      // Stepping backwards is a deliberate act; it pauses playback.
      return { ...state, index: clamp(state.index - 1, state.count), playing: false };
    case 'first':
      return { ...state, index: 0, playing: false };
    case 'last':
      return { ...state, index: clamp(state.count - 1, state.count), playing: false };
    case 'seek': {
      const index = clamp(action.index, state.count);
      if (index === state.index) return state;
      return { ...state, index, playing: false };
    }
    case 'setSpeed':
      // Speed changes must leave position and play/pause untouched.
      return state.speed === action.speed ? state : { ...state, speed: action.speed };
    case 'setCount': {
      const count = Math.max(0, Math.floor(action.count));
      const index = clamp(action.index ?? state.index, count);
      return { ...state, count, index, playing: state.playing && count > 1 && index < count - 1 };
    }
    case 'tick': {
      if (!state.playing) return state;
      if (isAtEnd(state)) return { ...state, playing: false };
      const index = clamp(state.index + 1, state.count);
      return { ...state, index, playing: index < state.count - 1 };
    }
    default:
      return state;
  }
}

export function nextSpeed(speed: Speed, direction: 1 | -1): Speed {
  const index = SPEEDS.indexOf(speed);
  const next = Math.min(Math.max(index + direction, 0), SPEEDS.length - 1);
  return SPEEDS[next]!;
}

export function isSpeed(value: unknown): value is Speed {
  return typeof value === 'number' && (SPEEDS as readonly number[]).includes(value);
}
