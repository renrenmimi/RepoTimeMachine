import type { Commit, CommitDetail, FileChange, RepoTree, TreeEntry } from '@/lib/domain/types';
import type { RawCommitDetail, RawCommitListItem, RawRepo, RawTree } from '@/lib/github/raw-types';

/** Deterministic 40-character hex, so fixtures compare stably. */
export function sha(seed: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    for (const char of `${seed}:${i}`) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

export function commit(overrides: Partial<Commit> & { index: number }): Commit {
  const id = overrides.sha ?? sha(`commit-${overrides.index}`);
  return {
    sha: id,
    shortSha: id.slice(0, 7),
    subject: `commit ${overrides.index}`,
    body: '',
    author: {
      name: 'Fixture Author',
      login: 'fixture-author',
      avatarUrl: null,
      date: new Date(Date.UTC(2026, 0, 1 + overrides.index, 12)).toISOString(),
    },
    committerDate: new Date(Date.UTC(2026, 0, 1 + overrides.index, 12)).toISOString(),
    parents: overrides.index === 0 ? [] : [sha(`commit-${overrides.index - 1}`)],
    htmlUrl: `https://github.com/owner/repo/commit/${id}`,
    ...overrides,
  };
}

export function commits(count: number): Commit[] {
  return Array.from({ length: count }, (_, index) => commit({ index }));
}

export function fileChange(overrides: Partial<FileChange> & { path: string }): FileChange {
  return {
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: null,
    patchOmittedReason: null,
    patchTruncated: false,
    blobUrl: null,
    ...overrides,
  };
}

export function detail(shaValue: string, files: FileChange[]): CommitDetail {
  return {
    sha: shaValue,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    changedFiles: files.length,
    files,
    filesTruncated: false,
  };
}

export function tree(commitSha: string, paths: (string | [string, number])[]): RepoTree {
  const entries: TreeEntry[] = [];
  const directories = new Set<string>();
  for (const item of paths) {
    const [path, size] = Array.isArray(item) ? item : [item, 100];
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
    entries.push({ path, type: 'blob', size, sha: sha(`blob-${path}`) });
  }
  for (const directory of directories) {
    entries.push({ path: directory, type: 'tree', size: null, sha: sha(`tree-${directory}`) });
  }
  return { commitSha, entries, truncated: false };
}

// ---- raw REST payloads, for adapter tests ----------------------------------

export function rawRepo(overrides: Partial<RawRepo> = {}): RawRepo {
  return {
    name: 'repo',
    full_name: 'owner/repo',
    owner: { login: 'owner' },
    description: 'A fixture repository',
    default_branch: 'main',
    html_url: 'https://github.com/owner/repo',
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: '2026-02-01T00:00:00Z',
    language: 'TypeScript',
    stargazers_count: 3,
    forks_count: 1,
    size: 120,
    license: { spdx_id: 'MIT', name: 'MIT License' },
    topics: ['git', 'visualisation'],
    archived: false,
    fork: false,
    ...overrides,
  };
}

export function rawCommit(overrides: Partial<RawCommitListItem> = {}): RawCommitListItem {
  const id = overrides.sha ?? sha('raw-commit');
  return {
    sha: id,
    html_url: `https://github.com/owner/repo/commit/${id}`,
    commit: {
      message: 'feat: add a thing\n\nWith a body.',
      author: { name: 'Fixture Author', date: '2026-01-02T10:00:00Z' },
      committer: { name: 'Fixture Author', date: '2026-01-02T10:00:00Z' },
    },
    author: { login: 'fixture-author', avatar_url: null },
    parents: [{ sha: sha('parent') }],
    ...overrides,
  };
}

export function rawDetail(overrides: Partial<RawCommitDetail> = {}): RawCommitDetail {
  return {
    ...rawCommit(),
    stats: { additions: 10, deletions: 2, total: 12 },
    files: [],
    ...overrides,
  };
}

export function rawTree(overrides: Partial<RawTree> = {}): RawTree {
  return {
    sha: sha('raw-tree'),
    truncated: false,
    tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: sha('readme'), size: 42 }],
    ...overrides,
  };
}
