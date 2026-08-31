import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against source files that are not, in fact, text.
 *
 * A NUL byte in a `.tsx` file once slipped in as a sentinel value for "no
 * selection". It happened to behave correctly, so nothing failed — but `file`
 * reported the source as `data`, and Git stopped producing readable diffs for
 * it, which is how a reviewable change becomes an unreviewable one.
 */

const ROOT = process.cwd();

/** Tracked files whose contents are meant to be read by a person. */
function trackedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => /\.(ts|tsx|js|mjs|cjs|json|css|md|yml|yaml|svg|txt)$/.test(file))
    // Fixture bundles are generated data, checked separately below.
    .filter((file) => !file.startsWith('fixtures/'));
}

const files = trackedTextFiles();

describe('tracked source files are text', () => {
  it('finds files to check, so the guard cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain('src/components/ComparePicker.tsx');
    expect(files).toContain('src/components/ComparePanel.tsx');
  });

  it('contains no NUL byte anywhere', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const data = readFileSync(path.join(ROOT, file));
      const index = data.indexOf(0);
      if (index !== -1) {
        const line = data.subarray(0, index).toString('utf8').split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('decodes as UTF-8 without replacement characters', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const data = readFileSync(path.join(ROOT, file));
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(data);
      // U+FFFD only appears when a byte sequence was not valid UTF-8.
      if (decoded.includes('�')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('lets Git treat every one of them as text', () => {
    // `git grep -I` skips binary files, so a file Git considers binary will not
    // be reported here even though its content matches.
    const listed = execFileSync('git', ['grep', '-I', '--name-only', '-e', '', '--', '.'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const binaryToGit = files.filter((file) => !listed.includes(file));
    expect(binaryToGit).toEqual([]);
  });
});

describe('generated fixture bundles are still valid JSON text', () => {
  const bundles = execFileSync('git', ['ls-files', '-z', 'fixtures'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file.endsWith('.json'));

  it('parses every bundle', () => {
    expect(bundles.length).toBeGreaterThan(0);
    for (const file of bundles) {
      const raw = readFileSync(path.join(ROOT, file), 'utf8');
      expect(raw.includes('\0'), file).toBe(false);
      expect(() => JSON.parse(raw), file).not.toThrow();
    }
  });
});
