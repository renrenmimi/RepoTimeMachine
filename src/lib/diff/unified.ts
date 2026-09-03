/**
 * A unified diff, computed from two versions of a file.
 *
 * This exists so the built-in demo can *derive* its diffs from real file
 * contents instead of shipping hand-written hunks alongside hand-written line
 * counts. Two numbers written by hand next to a hunk written by hand will
 * eventually disagree with each other; a diff computed from the content cannot.
 *
 * Deliberately not a dependency: the demo's largest file is a few hundred lines,
 * and the whole implementation is shorter than the code it would take to
 * configure a diffing library.
 */

export type DiffHunk = {
  /** 1-based start line in the old file. 0 when the old file is empty. */
  oldStart: number;
  oldLines: number;
  /** 1-based start line in the new file. 0 when the new file is empty. */
  newStart: number;
  newLines: number;
  /** Lines with their leading ` `, `+` or `-` already applied. */
  lines: string[];
};

export type UnifiedDiff = {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** The `@@ … @@` text, ready to render. Empty when nothing changed. */
  patch: string;
};

/** Lines of context kept either side of a change, as `diff -U3` would. */
const CONTEXT = 3;

type Op = { kind: 'same' | 'add' | 'remove'; line: string };

/**
 * The shortest edit script between two line arrays.
 *
 * A plain longest-common-subsequence table: O(n·m) in time and memory, which is
 * the right trade at these sizes and, unlike the heuristics real diff tools use
 * to stay fast on huge inputs, gives an answer that is easy to reason about.
 */
function editScript(before: readonly string[], after: readonly string[]): Op[] {
  const n = before.length;
  const m = after.length;

  // Common prefix and suffix are trimmed first, which is what keeps the table
  // small for the usual case of a small edit inside a large file.
  let start = 0;
  while (start < n && start < m && before[start] === after[start]) start += 1;

  let endBefore = n;
  let endAfter = m;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const midBefore = before.slice(start, endBefore);
  const midAfter = after.slice(start, endAfter);

  const rows = midBefore.length;
  const cols = midAfter.length;
  const width = cols + 1;
  const lengths = new Uint32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        midBefore[i] === midAfter[j]
          ? lengths[(i + 1) * width + (j + 1)]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + (j + 1)]!);
    }
  }

  const ops: Op[] = [];
  for (let k = 0; k < start; k += 1) ops.push({ kind: 'same', line: before[k]! });

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (midBefore[i] === midAfter[j]) {
      ops.push({ kind: 'same', line: midBefore[i]! });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + (j + 1)]!) {
      // A removal is emitted before an addition at the same position, which is
      // the order `diff` uses and the order a reader expects.
      ops.push({ kind: 'remove', line: midBefore[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'add', line: midAfter[j]! });
      j += 1;
    }
  }
  while (i < rows) {
    ops.push({ kind: 'remove', line: midBefore[i]! });
    i += 1;
  }
  while (j < cols) {
    ops.push({ kind: 'add', line: midAfter[j]! });
    j += 1;
  }

  for (let k = endBefore; k < n; k += 1) ops.push({ kind: 'same', line: before[k]! });

  return ops;
}

/** Groups the edit script into hunks, each carrying up to `CONTEXT` lines either side. */
function toHunks(ops: readonly Op[]): DiffHunk[] {
  const changed: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]!.kind !== 'same') changed.push(i);
  }
  if (changed.length === 0) return [];

  // Ranges of op indices that belong to one hunk, merged where their context
  // windows touch — two changes four lines apart read better as one hunk.
  const ranges: { from: number; to: number }[] = [];
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(ops.length - 1, index + CONTEXT);
    const last = ranges.at(-1);
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }

  const hunks: DiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;

  for (const range of ranges) {
    // Advance the line counters over everything before this hunk.
    for (; cursor < range.from; cursor += 1) {
      const op = ops[cursor]!;
      if (op.kind !== 'add') oldLine += 1;
      if (op.kind !== 'remove') newLine += 1;
    }

    const lines: string[] = [];
    let oldLines = 0;
    let newLines = 0;

    for (; cursor <= range.to; cursor += 1) {
      const op = ops[cursor]!;
      if (op.kind === 'same') {
        lines.push(` ${op.line}`);
        oldLines += 1;
        newLines += 1;
      } else if (op.kind === 'remove') {
        lines.push(`-${op.line}`);
        oldLines += 1;
      } else {
        lines.push(`+${op.line}`);
        newLines += 1;
      }
    }

    hunks.push({
      // A zero-length side starts at 0, which is what `diff` emits for a file
      // that is being created or deleted outright.
      oldStart: oldLines === 0 ? 0 : oldLine,
      oldLines,
      newStart: newLines === 0 ? 0 : newLine,
      newLines,
      lines,
    });

    oldLine += oldLines;
    newLine += newLines;
  }

  return hunks;
}

function header(hunk: DiffHunk): string {
  const old = hunk.oldLines === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldLines}`;
  const next = hunk.newLines === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newLines}`;
  return `@@ -${old} +${next} @@`;
}

/**
 * Splits file text into lines for diffing.
 *
 * A trailing newline does not make a final empty line: a file ending in `\n` has
 * as many lines as it has newlines, which is what makes `+` counts match what a
 * person would count.
 */
export function toLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * The unified diff between two file versions.
 *
 * `additions` and `deletions` are counted from the diff itself, so they cannot
 * describe a change other than the one shown.
 */
export function diffLines(before: readonly string[], after: readonly string[]): UnifiedDiff {
  const hunks = toHunks(editScript(before, after));
  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
  }

  const patch = hunks.map((hunk) => [header(hunk), ...hunk.lines].join('\n')).join('\n');
  return { hunks, additions, deletions, patch };
}

/** The unified diff between two file texts. */
export function diffText(before: string, after: string): UnifiedDiff {
  return diffLines(toLines(before), toLines(after));
}

/** One row of a two-column view of a hunk. */
export type SideBySideRow =
  | { kind: 'hunk'; text: string }
  /** Unchanged on both sides. */
  | { kind: 'context'; oldNumber: number; newNumber: number; text: string }
  /** Removed on the left, added on the right, or one side of a replacement. */
  | { kind: 'change'; oldNumber: number | null; newNumber: number | null; removed: string | null; added: string | null };

/**
 * A unified diff, arranged as two columns.
 *
 * Derived from the same hunks the unified view renders, so the two cannot
 * disagree about what changed — only about how it is laid out. Consecutive
 * removals and additions inside a hunk are paired up, which is what makes a
 * replaced line readable side by side instead of as two separate rows.
 */
export function toSideBySide(patch: string): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldNumber = 0;
  let newNumber = 0;

  /** Removals and additions waiting to be paired at the end of a run. */
  let removed: { line: string; number: number }[] = [];
  let added: { line: string; number: number }[] = [];

  const flush = () => {
    const pairs = Math.max(removed.length, added.length);
    for (let i = 0; i < pairs; i += 1) {
      const left = removed[i];
      const right = added[i];
      rows.push({
        kind: 'change',
        oldNumber: left?.number ?? null,
        newNumber: right?.number ?? null,
        removed: left?.line ?? null,
        added: right?.line ?? null,
      });
    }
    removed = [];
    added = [];
  };

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      flush();
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      // A header that does not parse is still shown, rather than dropped.
      oldNumber = match ? Number(match[1]) : oldNumber;
      newNumber = match ? Number(match[2]) : newNumber;
      rows.push({ kind: 'hunk', text: raw });
      continue;
    }

    const body = raw.slice(1);
    if (raw.startsWith('-')) {
      removed.push({ line: body, number: oldNumber });
      oldNumber += 1;
    } else if (raw.startsWith('+')) {
      added.push({ line: body, number: newNumber });
      newNumber += 1;
    } else {
      flush();
      rows.push({ kind: 'context', oldNumber, newNumber, text: body });
      oldNumber += 1;
      newNumber += 1;
    }
  }

  flush();
  return rows;
}
