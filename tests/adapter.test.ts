import { describe, expect, it } from 'vitest';
import {
  MAX_COMMIT_FILES,
  MAX_COMMIT_PATCH_CHARS,
  MAX_PATCH_CHARS,
  splitMessage,
  toCommit,
  toCommitDetail,
  toRepoMeta,
  toRepoTree,
  toTags,
} from '@/lib/github/adapter';
import { rawCommit, rawDetail, rawRepo, rawTree, sha } from './factories';

describe('splitMessage', () => {
  it('splits a subject from a body', () => {
    expect(splitMessage('feat: thing\n\nBody line one.\nBody line two.')).toEqual({
      subject: 'feat: thing',
      body: 'Body line one.\nBody line two.',
    });
  });

  it('handles a subject with no body', () => {
    expect(splitMessage('chore: tidy')).toEqual({ subject: 'chore: tidy', body: '' });
  });

  it('normalises CRLF line endings', () => {
    expect(splitMessage('subject\r\n\r\nbody')).toEqual({ subject: 'subject', body: 'body' });
  });

  it('survives an empty message', () => {
    expect(splitMessage('')).toEqual({ subject: '', body: '' });
  });
});

describe('toCommit', () => {
  it('maps the fields the UI needs and nothing else', () => {
    const mapped = toCommit(rawCommit(), 4);
    expect(mapped.subject).toBe('feat: add a thing');
    expect(mapped.body).toBe('With a body.');
    expect(mapped.shortSha).toHaveLength(7);
    expect(mapped.index).toBe(4);
    expect(mapped.author.name).toBe('Fixture Author');
    expect(mapped.author.login).toBe('fixture-author');
    expect(mapped.parents).toHaveLength(1);
  });

  it('falls back to a placeholder for an empty commit message', () => {
    const mapped = toCommit(rawCommit({ commit: { message: '', author: null, committer: null } }), 0);
    expect(mapped.subject).toBe('(no commit message)');
  });

  it('falls back to the GitHub login when the git author name is missing', () => {
    const mapped = toCommit(
      rawCommit({ commit: { message: 'x', author: { name: '  ', date: '2026-01-01T00:00:00Z' }, committer: null } }),
      0,
    );
    expect(mapped.author.name).toBe('fixture-author');
  });

  it('handles a commit with no linked GitHub account', () => {
    const mapped = toCommit(rawCommit({ author: null }), 0);
    expect(mapped.author.login).toBeNull();
    expect(mapped.author.avatarUrl).toBeNull();
  });
});

describe('toCommitDetail — patches', () => {
  it('keeps a short patch verbatim', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [
          {
            filename: 'a.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            changes: 2,
            patch: '@@ -1 +1 @@\n-a\n+b',
          },
        ],
      }),
    );
    expect(detail.files[0]?.patch).toBe('@@ -1 +1 @@\n-a\n+b');
    expect(detail.files[0]?.patchTruncated).toBe(false);
    expect(detail.files[0]?.patchOmittedReason).toBeNull();
  });

  it('truncates an over-long patch and says so', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [
          {
            filename: 'big.ts',
            status: 'modified',
            additions: 900,
            deletions: 5,
            changes: 905,
            patch: 'x'.repeat(MAX_PATCH_CHARS + 500),
          },
        ],
      }),
    );
    expect(detail.files[0]?.patch).toHaveLength(MAX_PATCH_CHARS);
    expect(detail.files[0]?.patchTruncated).toBe(true);
  });

  it('marks a missing patch on a zero-line change as binary', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [{ filename: 'logo.png', status: 'added', additions: 0, deletions: 0, changes: 0, patch: null }],
      }),
    );
    expect(detail.files[0]?.patch).toBeNull();
    expect(detail.files[0]?.patchOmittedReason).toBe('binary');
  });

  it('marks a missing patch on a large change as too-large', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [{ filename: 'huge.json', status: 'modified', additions: 50_000, deletions: 10, changes: 50_010 }],
      }),
    );
    expect(detail.files[0]?.patchOmittedReason).toBe('too-large');
  });

  it('stops spending patch budget once the commit total is reached', () => {
    const files = Array.from({ length: 40 }, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'modified',
      additions: 100,
      deletions: 100,
      changes: 200,
      patch: 'y'.repeat(MAX_PATCH_CHARS),
    }));
    const detail = toCommitDetail(rawDetail({ files }));
    const total = detail.files.reduce((sum, file) => sum + (file.patch?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_COMMIT_PATCH_CHARS);
    // Files past the budget still appear, with an explanation instead of a diff.
    const dropped = detail.files.filter((file) => file.patch === null);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0]?.patchOmittedReason).toBe('too-large');
  });

  it('caps the file list at GitHub’s own limit and flags truncation', () => {
    const files = Array.from({ length: 320 }, (_, i) => ({
      filename: `file-${i}.ts`,
      status: 'added',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: null,
    }));
    const detail = toCommitDetail(rawDetail({ files }));
    expect(detail.files).toHaveLength(MAX_COMMIT_FILES);
    expect(detail.changedFiles).toBe(320);
    expect(detail.filesTruncated).toBe(true);
  });

  it('keeps rename information', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [
          {
            filename: 'src/new-name.ts',
            previous_filename: 'src/old-name.ts',
            status: 'renamed',
            additions: 0,
            deletions: 0,
            changes: 0,
            patch: null,
          },
        ],
      }),
    );
    expect(detail.files[0]?.status).toBe('renamed');
    expect(detail.files[0]?.previousPath).toBe('src/old-name.ts');
  });

  it('normalises an unknown status rather than trusting it', () => {
    const detail = toCommitDetail(
      rawDetail({
        files: [{ filename: 'a.ts', status: 'exploded', additions: 1, deletions: 0, changes: 1, patch: null }],
      }),
    );
    expect(detail.files[0]?.status).toBe('modified');
  });

  it('survives a commit with no files array at all', () => {
    const detail = toCommitDetail(rawDetail({ files: null }));
    expect(detail.files).toEqual([]);
    expect(detail.filesTruncated).toBe(false);
  });

  it('derives totals when GitHub omits stats', () => {
    const detail = toCommitDetail(
      rawDetail({
        stats: null,
        files: [
          { filename: 'a.ts', status: 'modified', additions: 3, deletions: 1, changes: 4, patch: null },
          { filename: 'b.ts', status: 'modified', additions: 5, deletions: 2, changes: 7, patch: null },
        ],
      }),
    );
    expect(detail.additions).toBe(8);
    expect(detail.deletions).toBe(3);
  });
});

describe('toRepoMeta', () => {
  it('maps metadata and prefers the SPDX licence id', () => {
    const meta = toRepoMeta(rawRepo(), false);
    expect(meta.slug).toBe('owner/repo');
    expect(meta.license).toBe('MIT');
    expect(meta.topics).toEqual(['git', 'visualisation']);
    expect(meta.isEmpty).toBe(false);
  });

  it('falls back to the licence name when SPDX says NOASSERTION', () => {
    const meta = toRepoMeta(rawRepo({ license: { spdx_id: 'NOASSERTION', name: 'Custom' } }), false);
    expect(meta.license).toBe('Custom');
  });

  it('handles a repository with no licence, topics or push date', () => {
    const meta = toRepoMeta(rawRepo({ license: null, topics: null, pushed_at: null }), true);
    expect(meta.license).toBeNull();
    expect(meta.topics).toEqual([]);
    expect(meta.pushedAt).toBe(meta.createdAt);
    expect(meta.isEmpty).toBe(true);
  });
});

describe('toRepoTree', () => {
  it('keeps blobs and trees, and drops submodules', () => {
    const mapped = toRepoTree(
      rawTree({
        tree: [
          { path: 'README.md', mode: '100644', type: 'blob', sha: sha('a'), size: 10 },
          { path: 'src', mode: '040000', type: 'tree', sha: sha('b') },
          { path: 'vendor/dep', mode: '160000', type: 'commit', sha: sha('c') },
        ],
      }),
      sha('head'),
    );
    expect(mapped.entries.map((entry) => entry.path)).toEqual(['README.md', 'src']);
    expect(mapped.commitSha).toBe(sha('head'));
  });

  it('carries GitHub’s truncation flag through', () => {
    expect(toRepoTree(rawTree({ truncated: true }), sha('head')).truncated).toBe(true);
  });
});

describe('toTags', () => {
  it('maps tags and tolerates an empty list', () => {
    expect(toTags([{ name: 'v1.0.0', commit: { sha: sha('t') } }])).toEqual([{ name: 'v1.0.0', sha: sha('t') }]);
    expect(toTags([])).toEqual([]);
  });
});
