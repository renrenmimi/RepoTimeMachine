import { describe, expect, it } from 'vitest';
import { diffLines, diffText, toLines, toSideBySide } from '@/lib/diff/unified';

/** Applies a unified diff to `before` and returns the result, for round-tripping. */
function apply(before: string[], patch: string): string[] {
  const out: string[] = [];
  let cursor = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (!match) throw new Error(`unparsable hunk header: ${raw}`);
      const oldStart = Number(match[1]);
      // A zero start means the old side is empty, so there is nothing to copy.
      const target = oldStart === 0 ? cursor : oldStart - 1;
      while (cursor < target) {
        out.push(before[cursor]!);
        cursor += 1;
      }
      continue;
    }
    const kind = raw[0];
    const line = raw.slice(1);
    if (kind === ' ') {
      out.push(line);
      cursor += 1;
    } else if (kind === '-') {
      cursor += 1;
    } else if (kind === '+') {
      out.push(line);
    }
  }

  while (cursor < before.length) {
    out.push(before[cursor]!);
    cursor += 1;
  }
  return out;
}

describe('toLines', () => {
  it('treats a trailing newline as a terminator, not an extra line', () => {
    expect(toLines('a\nb\n')).toEqual(['a', 'b']);
    expect(toLines('a\nb')).toEqual(['a', 'b']);
  });

  it('reads an empty file as no lines', () => {
    expect(toLines('')).toEqual([]);
  });

  it('keeps genuinely blank lines', () => {
    expect(toLines('a\n\nb\n')).toEqual(['a', '', 'b']);
  });
});

describe('diffLines', () => {
  it('reports no change between identical files', () => {
    const diff = diffLines(['a', 'b'], ['a', 'b']);
    expect(diff.hunks).toEqual([]);
    expect(diff.patch).toBe('');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });

  it('describes a new file as one hunk starting at zero on the old side', () => {
    const diff = diffLines([], ['one', 'two', 'three']);
    expect(diff.patch).toBe('@@ -0,0 +1,3 @@\n+one\n+two\n+three');
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(0);
  });

  it('describes a deleted file the same way in reverse', () => {
    const diff = diffLines(['one', 'two'], []);
    expect(diff.patch).toBe('@@ -1,2 +0,0 @@\n-one\n-two');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(2);
  });

  it('keeps three lines of context either side of a change', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const after = ['1', '2', '3', '4', 'four-and-a-half', '5', '6', '7', '8', '9'];
    const diff = diffLines(before, after);

    // Three context lines before the insertion (2, 3, 4) and three after
    // (5, 6, 7): six old lines, seven new ones.
    expect(diff.patch).toBe(
      ['@@ -2,6 +2,7 @@', ' 2', ' 3', ' 4', '+four-and-a-half', ' 5', ' 6', ' 7'].join('\n'),
    );
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);
  });

  it('emits one hunk when two changes are close together', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const after = ['a', 'B', 'c', 'd', 'e', 'F', 'g'];
    const diff = diffLines(before, after);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });

  it('emits two hunks when the changes are far apart', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[2] = 'changed near the top';
    after[36] = 'changed near the bottom';
    const diff = diffLines(before, after);

    expect(diff.hunks).toHaveLength(2);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });

  it('puts the removal before the addition when a line is replaced', () => {
    const diff = diffLines(['keep', 'old', 'keep2'], ['keep', 'new', 'keep2']);
    const body = diff.patch.split('\n').filter((line) => !line.startsWith('@@'));
    expect(body).toEqual([' keep', '-old', '+new', ' keep2']);
  });

  it('counts additions and deletions from the hunks it emitted, never separately', () => {
    const before = ['a', 'b', 'c', 'd'];
    const after = ['a', 'x', 'y', 'z', 'd'];
    const diff = diffLines(before, after);

    const plus = diff.patch.split('\n').filter((line) => line.startsWith('+')).length;
    const minus = diff.patch.split('\n').filter((line) => line.startsWith('-')).length;
    expect(diff.additions).toBe(plus);
    expect(diff.deletions).toBe(minus);
  });

  it('uses the single-line hunk header form when a side is one line', () => {
    const diff = diffLines(['only'], ['only', 'and-another']);
    expect(diff.patch.split('\n')[0]).toBe('@@ -1 +1,2 @@');
  });

  it('handles a file whose every line changed', () => {
    const diff = diffLines(['a', 'b', 'c'], ['x', 'y', 'z']);
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(3);
    expect(apply(['a', 'b', 'c'], diff.patch)).toEqual(['x', 'y', 'z']);
  });

  it('handles blank lines and lines that look like diff syntax', () => {
    const before = ['keep', '', '-- not a removal', 'keep2'];
    const after = ['keep', '', '++ not an addition', 'keep2'];
    const diff = diffLines(before, after);
    expect(apply(before, diff.patch)).toEqual(after);
  });
});

describe('diffText round-trips', () => {
  /** Deterministic pseudo-random source, so a failure is reproducible. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('applying the patch to the old version yields the new one, over many shapes', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = makeRandom(seed);
      const length = Math.floor(random() * 30);
      const before = Array.from({ length }, (_, i) => `line ${i} ${Math.floor(random() * 3)}`);

      const after: string[] = [];
      for (const line of before) {
        const roll = random();
        if (roll < 0.2) continue; // deleted
        if (roll < 0.35) after.push(`${line} (edited)`);
        else after.push(line);
        if (random() < 0.15) after.push(`inserted ${Math.floor(random() * 100)}`);
      }
      if (random() < 0.3) after.push('appended at the end');

      const diff = diffLines(before, after);
      expect(apply(before, diff.patch), `seed ${seed}`).toEqual(after);

      const plus = diff.patch.split('\n').filter((l) => l.startsWith('+')).length;
      const minus = diff.patch.split('\n').filter((l) => l.startsWith('-')).length;
      expect(diff.additions, `seed ${seed} additions`).toBe(plus);
      expect(diff.deletions, `seed ${seed} deletions`).toBe(minus);
    }
  });

  it('is stable: the same input always produces the same patch', () => {
    const before = 'alpha\nbravo\ncharlie\ndelta\n';
    const after = 'alpha\nbravo-changed\ncharlie\ndelta\necho\n';
    const first = diffText(before, after).patch;
    for (let i = 0; i < 5; i += 1) {
      expect(diffText(before, after).patch).toBe(first);
    }
  });

  it('never reports a change for text that only differs by a trailing newline', () => {
    // The trailing newline is a terminator, so these are the same three lines.
    expect(diffText('a\nb\nc', 'a\nb\nc\n').patch).toBe('');
  });
});

describe('toSideBySide', () => {
  it('pairs a replaced line onto one row', () => {
    const patch = diffLines(['keep', 'old', 'keep2'], ['keep', 'new', 'keep2']).patch;
    const rows = toSideBySide(patch);

    expect(rows.map((row) => row.kind)).toEqual(['hunk', 'context', 'change', 'context']);
    expect(rows[2]).toEqual({
      kind: 'change',
      oldNumber: 2,
      newNumber: 2,
      removed: 'old',
      added: 'new',
    });
  });

  it('leaves the other side empty for a pure insertion', () => {
    const patch = diffLines(['a', 'b'], ['a', 'inserted', 'b']).patch;
    const change = toSideBySide(patch).find((row) => row.kind === 'change');
    expect(change).toEqual({
      kind: 'change',
      oldNumber: null,
      newNumber: 2,
      removed: null,
      added: 'inserted',
    });
  });

  it('leaves the other side empty for a pure deletion', () => {
    const patch = diffLines(['a', 'gone', 'b'], ['a', 'b']).patch;
    const change = toSideBySide(patch).find((row) => row.kind === 'change');
    expect(change).toEqual({
      kind: 'change',
      oldNumber: 2,
      newNumber: null,
      removed: 'gone',
      added: null,
    });
  });

  it('numbers both sides independently, so the columns stay truthful', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const after = ['1', '2', 'x', 'y', '5', '6', '7', '8'];
    const rows = toSideBySide(diffLines(before, after).patch);

    for (const row of rows) {
      if (row.kind === 'context') {
        expect(before[row.oldNumber - 1]).toBe(row.text);
        expect(after[row.newNumber - 1]).toBe(row.text);
      }
      if (row.kind === 'change') {
        if (row.removed !== null) expect(before[row.oldNumber! - 1]).toBe(row.removed);
        if (row.added !== null) expect(after[row.newNumber! - 1]).toBe(row.added);
      }
    }
  });

  it('describes exactly the same change as the unified view', () => {
    const before = ['a', 'b', 'c', 'd', 'e'];
    const after = ['a', 'B', 'c', 'inserted', 'd'];
    const diff = diffLines(before, after);
    const rows = toSideBySide(diff.patch);

    const added = rows.filter((row) => row.kind === 'change' && row.added !== null).length;
    const removed = rows.filter((row) => row.kind === 'change' && row.removed !== null).length;
    expect(added).toBe(diff.additions);
    expect(removed).toBe(diff.deletions);
  });

  it('keeps a new file readable, with nothing on the left', () => {
    const rows = toSideBySide(diffLines([], ['one', 'two']).patch);
    const changes = rows.filter((row) => row.kind === 'change');
    expect(changes).toHaveLength(2);
    for (const row of changes) {
      if (row.kind !== 'change') continue;
      expect(row.removed).toBeNull();
      expect(row.oldNumber).toBeNull();
    }
  });

  it('handles several hunks', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[2] = 'top';
    after[36] = 'bottom';
    const rows = toSideBySide(diffLines(before, after).patch);
    expect(rows.filter((row) => row.kind === 'hunk')).toHaveLength(2);
  });
});
