import type { Commit, FileChange, Tag } from '@/lib/domain/types';
import { classifyPath } from '@/lib/tree/classify';
import { SIGNATURES, type SignatureKind } from './signatures';

export type MilestoneKind =
  | SignatureKind
  | 'initial-commit'
  | 'release-tag'
  | 'merge-commit'
  | 'breaking-change'
  | 'revert'
  | 'large-change'
  | 'structural-change'
  | 'new-language';

/** How sure we are about *which commit* a milestone belongs to. */
export type MilestoneConfidence =
  /** We inspected this commit's own file list. */
  | 'exact'
  /** GitHub told us which commit first touched the path. */
  | 'probed'
  /** We only know it happened somewhere between two snapshots. */
  | 'window';

export type Milestone = {
  id: string;
  sha: string;
  commitIndex: number;
  kind: MilestoneKind;
  label: string;
  /** Plain-language statement of the rule that fired. */
  rule: string;
  /** What this specific commit did to trigger it. */
  evidence: string;
  confidence: MilestoneConfidence;
  /** Set for `window` confidence: the commit range the event fell inside. */
  window?: { fromIndex: number; toIndex: number };
};

export type Snapshot = {
  commitIndex: number;
  paths: ReadonlySet<string>;
};

export type MilestoneInput = {
  /** Oldest-first, `index` already assigned. */
  commits: readonly Commit[];
  tags: readonly Tag[];
  /** File changes for the commits we have detail for. */
  changesBySha: ReadonlyMap<string, readonly FileChange[]>;
  /** Tree snapshots, oldest first. Used to bracket events we have no diff for. */
  snapshots: readonly Snapshot[];
  /** `path -> sha of the commit that first added it`, from path-scoped queries. */
  probes?: ReadonlyMap<string, string>;
};

/** A commit is "unusually large" when it is this many times the median size. */
const LARGE_CHANGE_MULTIPLE = 4;
/** …and at least this many changed lines, so tiny repositories do not flag everything. */
const LARGE_CHANGE_FLOOR = 400;
/** Minimum sample size before the "unusually large" comparison means anything. */
const LARGE_CHANGE_MIN_SAMPLES = 6;
/** New top-level directories in one commit before we call it a structural change. */
const STRUCTURAL_DIR_THRESHOLD = 3;

const PROGRAMMING_LANGUAGES = new Set([
  'TypeScript', 'JavaScript', 'Python', 'Ruby', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift',
  'Objective-C', 'C', 'C++', 'C#', 'PHP', 'Elixir', 'Dart', 'Scala', 'Shell', 'SQL',
  'Vue', 'Svelte', 'Astro', 'Lua', 'R', 'Perl', 'Haskell', 'Clojure', 'Zig',
]);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function topDirectory(path: string): string | null {
  const index = path.indexOf('/');
  return index === -1 ? null : path.slice(0, index);
}

function addedPaths(changes: readonly FileChange[]): string[] {
  return changes.filter((c) => c.status === 'added' || c.status === 'copied' || c.status === 'renamed').map((c) => c.path);
}

/**
 * Runs every heuristic over the loaded range.
 *
 * The result is intentionally conservative: a rule only fires when there is
 * direct evidence in the data we actually hold, and every milestone records
 * both the rule and the evidence so a reader can disagree with it.
 */
export function detectMilestones(input: MilestoneInput): Milestone[] {
  const { commits, tags, changesBySha, snapshots } = input;
  const probes = input.probes ?? new Map<string, string>();
  const milestones: Milestone[] = [];
  const indexBySha = new Map(commits.map((c) => [c.sha, c.index]));

  const push = (m: Omit<Milestone, 'id'>) => {
    milestones.push({ ...m, id: `${m.kind}:${m.sha}` });
  };

  // ---- metadata rules: always available, no extra requests -----------------
  for (const commit of commits) {
    if (commit.parents.length === 0) {
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'initial-commit',
        label: 'Initial commit',
        rule: 'The commit has no parent.',
        evidence: 'This is the first commit in the repository.',
        confidence: 'exact',
      });
    }
    if (commit.parents.length > 1) {
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'merge-commit',
        label: 'Merge commit',
        rule: 'The commit has more than one parent.',
        evidence: `${commit.parents.length} parents: ${commit.parents.map((p) => p.slice(0, 7)).join(', ')}.`,
        confidence: 'exact',
      });
    }
    const subject = commit.subject;
    if (/^[a-z]+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(commit.body)) {
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'breaking-change',
        label: 'Marked breaking',
        rule: 'The commit message uses the Conventional Commits breaking-change marker.',
        evidence: 'The author labelled this commit breaking; the rule only reads that label.',
        confidence: 'exact',
      });
    }
    if (/^revert[\s:"']/i.test(subject)) {
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'revert',
        label: 'Revert',
        rule: 'The commit subject begins with "Revert".',
        evidence: 'Earlier work was undone here, according to the message.',
        confidence: 'exact',
      });
    }
  }

  for (const tag of tags) {
    const index = indexBySha.get(tag.sha);
    if (index === undefined) continue;
    push({
      sha: tag.sha,
      commitIndex: index,
      kind: 'release-tag',
      label: `Tagged ${tag.name}`,
      rule: 'A Git tag points at this commit.',
      evidence: `Tag "${tag.name}".`,
      confidence: 'exact',
    });
  }

  // ---- path rules: first appearance of a signature file --------------------
  for (const signature of SIGNATURES) {
    const found = firstAppearance(signature.test, commits, changesBySha, snapshots, probes);
    if (!found) continue;
    push({
      sha: found.sha,
      commitIndex: found.commitIndex,
      kind: signature.kind,
      label: signature.label,
      rule: signature.rule,
      evidence: found.evidence,
      confidence: found.confidence,
      ...(found.window ? { window: found.window } : {}),
    });
  }

  // ---- size and shape rules: need per-commit diffs -------------------------
  const sizes: { commit: Commit; churn: number; files: number }[] = [];
  for (const commit of commits) {
    const changes = changesBySha.get(commit.sha);
    if (!changes) continue;
    const churn = changes.reduce((sum, c) => sum + c.additions + c.deletions, 0);
    sizes.push({ commit, churn, files: changes.length });
  }

  if (sizes.length >= LARGE_CHANGE_MIN_SAMPLES) {
    const med = median(sizes.map((s) => s.churn));
    const threshold = Math.max(med * LARGE_CHANGE_MULTIPLE, LARGE_CHANGE_FLOOR);
    for (const sample of sizes) {
      if (sample.churn < threshold) continue;
      push({
        sha: sample.commit.sha,
        commitIndex: sample.commit.index,
        kind: 'large-change',
        label: 'Unusually large change',
        rule: `Changed lines are at least ${LARGE_CHANGE_MULTIPLE}× the median of the commits inspected so far (and at least ${LARGE_CHANGE_FLOOR}).`,
        evidence: `${sample.churn.toLocaleString('en')} changed lines across ${sample.files} file${sample.files === 1 ? '' : 's'}; median is ${Math.round(med).toLocaleString('en')}.`,
        confidence: 'exact',
      });
    }
  }

  const seenDirs = new Set<string>();
  const seenLanguages = new Set<string>();
  if (snapshots.length > 0) {
    for (const path of snapshots[0]!.paths) {
      const dir = topDirectory(path);
      if (dir) seenDirs.add(dir);
      const language = classifyPath(path).language;
      if (language) seenLanguages.add(language);
    }
  }

  for (const commit of commits) {
    const changes = changesBySha.get(commit.sha);
    if (!changes) continue;
    const added = addedPaths(changes);

    const newDirs = new Set<string>();
    for (const path of added) {
      const dir = topDirectory(path);
      if (dir && !seenDirs.has(dir)) newDirs.add(dir);
    }
    if (newDirs.size >= STRUCTURAL_DIR_THRESHOLD) {
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'structural-change',
        label: 'Structural change',
        rule: `At least ${STRUCTURAL_DIR_THRESHOLD} top-level directories appear for the first time in one commit.`,
        evidence: `New top-level directories: ${[...newDirs].slice(0, 6).map((d) => `${d}/`).join(', ')}.`,
        confidence: 'exact',
      });
    }
    for (const dir of newDirs) seenDirs.add(dir);

    const newLanguages = new Set<string>();
    for (const path of added) {
      const language = classifyPath(path).language;
      if (language && PROGRAMMING_LANGUAGES.has(language) && !seenLanguages.has(language)) {
        newLanguages.add(language);
      }
    }
    for (const language of newLanguages) {
      seenLanguages.add(language);
      push({
        sha: commit.sha,
        commitIndex: commit.index,
        kind: 'new-language',
        label: `${language} appears`,
        rule: 'A file extension mapped to this language is added for the first time in the loaded range.',
        evidence: `First ${language} file: ${added.find((p) => classifyPath(p).language === language)}.`,
        confidence: 'exact',
      });
    }
  }

  return dedupe(milestones).sort((a, b) => a.commitIndex - b.commitIndex || a.kind.localeCompare(b.kind));
}

function dedupe(milestones: Milestone[]): Milestone[] {
  const byId = new Map<string, Milestone>();
  for (const milestone of milestones) {
    const existing = byId.get(milestone.id);
    if (!existing || rank(milestone.confidence) > rank(existing.confidence)) {
      byId.set(milestone.id, milestone);
    }
  }
  return [...byId.values()];
}

function rank(confidence: MilestoneConfidence): number {
  return confidence === 'exact' ? 3 : confidence === 'probed' ? 2 : 1;
}

type Appearance = {
  sha: string;
  commitIndex: number;
  evidence: string;
  confidence: MilestoneConfidence;
  window?: { fromIndex: number; toIndex: number };
};

/**
 * Finds when a signature first matched, preferring precise evidence.
 *
 * 1. a commit diff we hold that adds a matching path;
 * 2. a path-scoped query result;
 * 3. the gap between two tree snapshots, reported as a range.
 */
export function firstAppearance(
  test: (path: string) => boolean,
  commits: readonly Commit[],
  changesBySha: ReadonlyMap<string, readonly FileChange[]>,
  snapshots: readonly Snapshot[],
  probes: ReadonlyMap<string, string>,
): Appearance | null {
  const indexBySha = new Map(commits.map((c) => [c.sha, c.index]));

  // 1. exact: a diff we already hold.
  let exact: Appearance | null = null;
  for (const commit of commits) {
    const changes = changesBySha.get(commit.sha);
    if (!changes) continue;
    const match = addedPaths(changes).find(test);
    if (match) {
      exact = {
        sha: commit.sha,
        commitIndex: commit.index,
        evidence: `${match} is added here.`,
        confidence: 'exact',
      };
      break;
    }
  }

  // 2. probed: GitHub told us the oldest commit touching a matching path.
  let probed: Appearance | null = null;
  for (const [path, sha] of probes) {
    if (!test(path)) continue;
    const index = indexBySha.get(sha);
    if (index === undefined) continue;
    if (!probed || index < probed.commitIndex) {
      probed = {
        sha,
        commitIndex: index,
        evidence: `${path} was first committed here.`,
        confidence: 'probed',
      };
    }
  }

  if (exact && probed) return exact.commitIndex <= probed.commitIndex ? exact : probed;
  if (exact) return exact;
  if (probed) return probed;

  // 3. window: bracketed by two snapshots.
  if (snapshots.length === 0) return null;
  const first = snapshots[0]!;
  const matchIn = (snapshot: Snapshot): string | undefined => [...snapshot.paths].find(test);
  if (matchIn(first)) return null; // already present before the loaded range started

  for (let i = 1; i < snapshots.length; i += 1) {
    const snapshot = snapshots[i]!;
    const match = matchIn(snapshot);
    if (!match) continue;
    const previous = snapshots[i - 1]!;
    const commit = commits.find((c) => c.index === snapshot.commitIndex);
    if (!commit) return null;
    return {
      sha: commit.sha,
      commitIndex: snapshot.commitIndex,
      evidence: `${match} exists at commit #${snapshot.commitIndex + 1} but not at #${previous.commitIndex + 1}. The exact commit is somewhere in between.`,
      confidence: 'window',
      window: { fromIndex: previous.commitIndex + 1, toIndex: snapshot.commitIndex },
    };
  }

  return null;
}
