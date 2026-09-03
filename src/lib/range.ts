import { formatNumber } from '@/lib/format';

/**
 * How the loaded range is described.
 *
 * "All 16 commits" and "Latest 300 of 640" are different claims, and the
 * difference matters the moment anyone asks what the first commit was. Both
 * phrasings live here so the history list and the player cannot drift apart —
 * and so neither has to invent its own wording for the same fact.
 */

/** For the history list, where the count answers "how long is this list". */
export function describeLoadedRange(count: number, totalCommits: number | null): string {
  if (count === 0) return 'No commits loaded';
  if (totalCommits === null) return `${formatNumber(count)} commits loaded`;
  if (count >= totalCommits) return `All ${formatNumber(count)} commit${count === 1 ? '' : 's'}`;
  return `Latest ${formatNumber(count)} of ${formatNumber(totalCommits)} commits`;
}

/**
 * For the player, where the useful fact is whether the track starts at the
 * repository's beginning or somewhere in the middle of its history.
 *
 * Worded differently from the list on purpose. Two labels that differ only in
 * capitalisation read as the same sentence repeated — to a person and, as it
 * turns out, to a test runner matching text.
 */
export function describePlayableRange(count: number, totalCommits: number | null): string {
  if (count === 0) return 'no commits loaded';
  if (totalCommits === null) return `${formatNumber(count)} commits loaded`;
  if (count >= totalCommits) return `the whole history, ${formatNumber(count)} commit${count === 1 ? '' : 's'}`;
  return `part of the history, ${formatNumber(count)} of ${formatNumber(totalCommits)} commits`;
}
