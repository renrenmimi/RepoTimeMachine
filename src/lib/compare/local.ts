import { diffText } from '@/lib/diff/unified';
import type {
  Commit,
  CommitDetail,
  CompareEndpoint,
  CompareStatus,
  FileChange,
  RepoCompare,
} from '@/lib/domain/types';

/**
 * Comparing two points of a history we already hold, without asking anyone.
 *
 * Used for the built-in demo in production, and for the recorded fixtures in
 * tests. Both have the whole history in memory, so the net difference between
 * two points can be read directly instead of being requested.
 */

/** Blob ids by path at one commit. A null id means "present, id unknown". */
export type LocalSnapshot = ReadonlyMap<string, string | null>;

export type LocalCompareSource = {
  /** Oldest first, with `index` assigned. */
  commits: readonly Commit[];
  /** The file list at a commit, or null when it is not known. */
  snapshotAt(sha: string): LocalSnapshot | null;
  /** The diff of one commit, or null when it is not known. */
  detailOf(sha: string): CommitDetail | null;
  /** Tag name pointing at a commit, for labelling an endpoint. */
  tagOf(sha: string): string | null;
  /**
   * The text of one file at one commit, when the source holds it.
   *
   * `undefined` means "not present at that commit"; `null` means "present, but
   * this source does not carry its content" — a generated file, say. A source
   * that implements this gets a real net diff between any two points instead of
   * a summary, because the difference can be computed rather than reassembled
   * out of the intervening commits' hunks.
   */
  contentAt?(sha: string, path: string): string | null | undefined;
};

/** Resolves a full or abbreviated sha against a known history. */
export function resolveLocalSha(commits: readonly Commit[], sha: string): Commit | null {
  const needle = sha.trim().toLowerCase();
  if (needle.length < 4) return null;
  return commits.find((commit) => commit.sha.startsWith(needle)) ?? null;
}

type Touch = {
  additions: number;
  deletions: number;
  /** Recorded hunks for this path, including the nulls, so they can be counted. */
  patches: (string | null)[];
  /** Status of the last change to this path in the range. */
  lastStatus: FileChange['status'];
  previousPath: string | null;
};

/**
 * Everything the commits in `(low, high]` did, per path.
 *
 * A rename is recorded against both names so the path can be matched from either
 * side of the comparison.
 */
function collectTouches(source: LocalCompareSource, low: number, high: number): Map<string, Touch> {
  const touches = new Map<string, Touch>();

  for (let i = low + 1; i <= high; i += 1) {
    const commit = source.commits[i];
    if (!commit) continue;
    const detail = source.detailOf(commit.sha);
    if (!detail) continue;

    for (const file of detail.files) {
      const names = [file.path, file.previousPath].filter((value): value is string => Boolean(value));
      for (const path of names) {
        const entry: Touch =
          touches.get(path) ??
          { additions: 0, deletions: 0, patches: [], lastStatus: file.status, previousPath: null };
        entry.additions += file.additions;
        entry.deletions += file.deletions;
        // Only the path the hunk actually describes collects it.
        if (path === file.path) {
          entry.patches.push(file.patch);
          entry.lastStatus = file.status;
          entry.previousPath = file.previousPath;
        }
        touches.set(path, entry);
      }
    }
  }

  return touches;
}

function endpoint(source: LocalCompareSource, commit: Commit): CompareEndpoint {
  const tagName = source.tagOf(commit.sha);
  return {
    kind: tagName ? 'tag' : 'commit',
    tagName,
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    authorName: commit.author.name,
    date: commit.author.date,
    htmlUrl: commit.htmlUrl,
  };
}

/** Reverses a status, for a comparison whose head precedes its base. */
function flipStatus(status: FileChange['status']): FileChange['status'] {
  if (status === 'added') return 'removed';
  if (status === 'removed') return 'added';
  return status;
}

/**
 * The net per-file difference between two points.
 *
 * When both snapshots are known the answer comes from them: a path only head has
 * was added, one only base has was removed, and one both have whose blob id
 * changed was modified. That stays exact however many times a file was touched
 * in between.
 *
 * When a snapshot is missing it falls back to the recorded diffs, which can only
 * describe paths those diffs mention — so the result is reported as truncated.
 */
function netFiles(
  source: LocalCompareSource,
  base: Commit,
  head: Commit,
  forward: boolean,
): { files: FileChange[]; incomplete: boolean } {
  const low = Math.min(base.index, head.index);
  const high = Math.max(base.index, head.index);
  const touches = collectTouches(source, low, high);

  const baseSnapshot = source.snapshotAt(base.sha);
  const headSnapshot = source.snapshotAt(head.sha);

  const build = (path: string, status: FileChange['status'], previousPath: string | null): FileChange => {
    const touch = touches.get(path);

    /*
     * When the source carries content, the net difference is *computed* from the
     * two versions. That is the whole answer, however many times the file was
     * touched in between, and its line counts come from the same diff — so the
     * numbers and the hunks cannot describe different changes.
     *
     * Always base to head, in the direction the visitor asked for. `forward`
     * describes where head sits in the history, not which way to read: a
     * comparison whose head precedes its base still describes head relative to
     * base, so its additions are what head has that base does not.
     */
    if (source.contentAt) {
      const fromText = source.contentAt(base.sha, path);
      const toText = source.contentAt(head.sha, path);
      const opaque = fromText === null || toText === null;

      if (!opaque) {
        const diff = diffText(fromText ?? '', toText ?? '');
        return {
          path,
          previousPath,
          status,
          additions: diff.additions,
          deletions: diff.deletions,
          patch: diff.patch === '' ? null : diff.patch,
          // An empty computed diff on a path that moved is a rename and nothing
          // more, which is a complete answer rather than a missing one.
          patchOmittedReason: diff.patch === '' ? (previousPath ? 'rename-only' : null) : null,
          patchTruncated: false,
          blobUrl: null,
        };
      }

      // Content exists but is not carried: say which, rather than "not provided".
      return {
        path,
        previousPath,
        status,
        additions: forward ? (touch?.additions ?? 0) : (touch?.deletions ?? 0),
        deletions: forward ? (touch?.deletions ?? 0) : (touch?.additions ?? 0),
        patch: null,
        patchOmittedReason: 'generated',
        patchTruncated: false,
        blobUrl: null,
      };
    }

    const patches = touch?.patches ?? [];
    const recorded = patches.filter((patch): patch is string => Boolean(patch));
    // A single recorded hunk in the forward direction *is* the net difference;
    // anything else would be one commit's hunk masquerading as the whole change.
    const usable = forward && patches.length === 1 && recorded.length === 1;

    return {
      path,
      previousPath,
      status,
      additions: forward ? (touch?.additions ?? 0) : (touch?.deletions ?? 0),
      deletions: forward ? (touch?.deletions ?? 0) : (touch?.additions ?? 0),
      patch: usable ? recorded[0]! : null,
      patchOmittedReason: usable ? null : patches.length > 1 ? 'aggregated' : 'not-provided',
      patchTruncated: false,
      blobUrl: null,
    };
  };

  const files: FileChange[] = [];

  if (baseSnapshot && headSnapshot) {
    const paths = new Set([...baseSnapshot.keys(), ...headSnapshot.keys()]);
    for (const path of paths) {
      const inBase = baseSnapshot.has(path);
      const inHead = headSnapshot.has(path);

      if (inBase && inHead) {
        const baseId = baseSnapshot.get(path) ?? null;
        const headId = headSnapshot.get(path) ?? null;
        const identical = baseId !== null && headId !== null && baseId === headId;
        if (identical) continue;
        // Ids missing on either side: fall back to whether anything touched it.
        if ((baseId === null || headId === null) && !touches.has(path)) continue;
        files.push(build(path, 'modified', touches.get(path)?.previousPath ?? null));
        continue;
      }

      // `inBase` and `inHead` already describe the requested direction, so this
      // status needs no reversing — only the line counts do, because the touches
      // were collected forwards through time.
      files.push(build(path, inHead ? 'added' : 'removed', null));
    }

    return { files: sortFiles(files), incomplete: false };
  }

  // Degraded path: only what the diffs mention can be described.
  for (const [path, touch] of touches) {
    if (touch.patches.length === 0 && touch.additions === 0 && touch.deletions === 0) continue;
    const status = forward ? touch.lastStatus : flipStatus(touch.lastStatus);
    files.push(build(path, status, touch.previousPath));
  }

  return { files: sortFiles(files), incomplete: true };
}

function sortFiles(files: FileChange[]): FileChange[] {
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/**
 * Compares two points of a known history.
 *
 * Returns null when either reference is not part of it, which the caller turns
 * into the ordinary not-found result.
 */
export function compareLocalHistory(
  source: LocalCompareSource,
  baseSha: string,
  headSha: string,
): RepoCompare | null {
  const base = resolveLocalSha(source.commits, baseSha);
  const head = resolveLocalSha(source.commits, headSha);
  if (!base || !head) return null;

  const forward = head.index >= base.index;
  const low = Math.min(base.index, head.index);
  const high = Math.max(base.index, head.index);
  const distance = high - low;

  const status: CompareStatus = distance === 0 ? 'identical' : forward ? 'ahead' : 'behind';

  const commits =
    forward && distance > 0
      ? source.commits.slice(base.index + 1, head.index + 1).map((commit, index) => ({ ...commit, index }))
      : [];

  const { files, incomplete } =
    status === 'identical' ? { files: [], incomplete: false } : netFiles(source, base, head, forward);

  return {
    base: endpoint(source, base),
    head: endpoint(source, head),
    status,
    // A linear history diverges from nothing, so one side is always zero.
    aheadBy: forward ? distance : 0,
    behindBy: forward ? 0 : distance,
    commits,
    commitsTruncated: false,
    files,
    filesTruncated: incomplete,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles: files.length,
    // In a linear history the common ancestor is simply the earlier point.
    mergeBaseSha: source.commits[low]?.sha ?? null,
    htmlUrl: null,
  };
}
