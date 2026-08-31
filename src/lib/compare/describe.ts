import type { RepoCompare } from '@/lib/domain/types';
import { formatNumber } from '@/lib/format';

/**
 * The spoken description of a comparison, for readers who cannot see the layout.
 *
 * Sighted readers get the direction from the base card sitting left of the head
 * card with an arrow between them. That arrow is the only thing saying which way
 * round the numbers run, so the sentence has to say it in words instead.
 *
 * `base...head` semantics put head on the moving side: `aheadBy` is how far
 * **head** is ahead of base, not the other way round. Each relation therefore
 * gets its own complete sentence rather than one template with the relation word
 * dropped into it — that template read "base is behind of head", which is both
 * ungrammatical and backwards.
 */

/** "1 commit" / "12 commits", with thousands separators. */
function count(value: number, noun: string): string {
  return `${formatNumber(value)} ${noun}${value === 1 ? '' : 's'}`;
}

/** How the two points relate, from head's point of view. */
export function describeCompareRelation(compare: RepoCompare): string {
  const base = compare.base.shortSha;
  const head = compare.head.shortSha;

  switch (compare.status) {
    case 'identical':
      return `${head} and ${base} identify the same commit.`;
    case 'ahead':
      return `${head} is ${count(compare.aheadBy, 'commit')} ahead of ${base}.`;
    case 'behind':
      return `${head} is ${count(compare.behindBy, 'commit')} behind ${base}.`;
    case 'diverged':
      return `${head} is ${count(compare.aheadBy, 'commit')} ahead of and ${count(
        compare.behindBy,
        'commit',
      )} behind ${base}.`;
  }
}

/** What differs between the two points. */
export function describeCompareChanges(compare: RepoCompare): string {
  if (compare.changedFiles === 0) return 'No file differs between them.';
  return `${count(compare.changedFiles, 'file')} changed, ${count(
    compare.additions,
    'line',
  )} added and ${formatNumber(compare.deletions)} removed.`;
}

/** The whole comparison in one sentence pair. */
export function describeComparison(compare: RepoCompare): string {
  return `${describeCompareRelation(compare)} ${describeCompareChanges(compare)}`;
}
