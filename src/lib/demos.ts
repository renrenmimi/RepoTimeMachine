import type { RepoRef } from '@/lib/repo-ref';

export type Demo = {
  ref: RepoRef;
  label: string;
  /** What this repository demonstrates about the timeline, not marketing copy. */
  note: string;
  /** Approximate commit count when the demo list was written. */
  approxCommits: number;
};

const ref = (owner: string, repo: string): RepoRef => ({ owner, repo, slug: `${owner}/${repo}` });

/**
 * Demo repositories, chosen for different history shapes: a five-commit
 * experiment, a mid-sized course project, an application built over a weekend,
 * and a long-running app with several hundred commits.
 */
export const DEMOS: Demo[] = [
  {
    ref: ref('renrenmimi', 'renren-across-tabs'),
    label: 'renren-across-tabs',
    note: 'Five commits. The whole history fits on one screen.',
    approxCommits: 5,
  },
  {
    ref: ref('renrenmimi', 'DataData'),
    label: 'DataData',
    note: 'About 30 commits; a course project that grew a structure early.',
    approxCommits: 32,
  },
  {
    ref: ref('renrenmimi', 'DrillLab'),
    label: 'DrillLab',
    note: 'About 60 commits over a few days, with a visible framework moment.',
    approxCommits: 64,
  },
  {
    ref: ref('renrenmimi', 'PetNote'),
    label: 'PetNote',
    note: 'Several hundred commits across months. Shows the loaded-range limits.',
    approxCommits: 246,
  },
];
