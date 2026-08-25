#!/usr/bin/env node
/**
 * Records sanitised GitHub payloads into `fixtures/` and generates the
 * synthetic bundles the test suite needs.
 *
 * Run it deliberately, never as part of a build or a test run:
 *
 *     GITHUB_TOKEN=... node scripts/record-fixtures.mjs
 *
 * What is removed: e-mail addresses, avatar URLs, and everything in the REST
 * responses this application does not read. Patches are capped so the fixtures
 * stay small enough to live in the repository.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.github.com';
const ROOT = path.join(process.cwd(), 'fixtures');
const PATCH_CAP = 900;

const token = process.env.GITHUB_TOKEN?.trim();

async function gh(pathname, params = {}) {
  const url = new URL(`${API}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'repo-time-machine-fixture-recorder',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${pathname}`);
  const link = response.headers.get('link') ?? '';
  return { data: await response.json(), link };
}

const lastPage = (link) => {
  const match = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match ? Number(match[1]) : 1;
};

function sanitiseRepo(raw) {
  return {
    name: raw.name,
    full_name: raw.full_name,
    owner: { login: raw.owner.login },
    description: raw.description,
    default_branch: raw.default_branch,
    html_url: raw.html_url,
    created_at: raw.created_at,
    pushed_at: raw.pushed_at,
    language: raw.language,
    stargazers_count: raw.stargazers_count,
    forks_count: raw.forks_count,
    size: raw.size,
    license: raw.license ? { spdx_id: raw.license.spdx_id, name: raw.license.name } : null,
    topics: raw.topics ?? [],
    archived: raw.archived,
    fork: raw.fork,
  };
}

function sanitiseCommit(raw) {
  return {
    sha: raw.sha,
    html_url: raw.html_url,
    commit: {
      message: raw.commit.message,
      // Author e-mail addresses are deliberately dropped.
      author: raw.commit.author ? { name: raw.commit.author.name, date: raw.commit.author.date } : null,
      committer: raw.commit.committer ? { name: raw.commit.committer.name, date: raw.commit.committer.date } : null,
    },
    author: raw.author ? { login: raw.author.login, avatar_url: null } : null,
    parents: (raw.parents ?? []).map((parent) => ({ sha: parent.sha })),
  };
}

function sanitiseDetail(raw) {
  return {
    ...sanitiseCommit(raw),
    stats: raw.stats ? { additions: raw.stats.additions, deletions: raw.stats.deletions, total: raw.stats.total } : null,
    files: (raw.files ?? []).map((file) => ({
      filename: file.filename,
      previous_filename: file.previous_filename ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: typeof file.patch === 'string' ? file.patch.slice(0, PATCH_CAP) : null,
      blob_url: file.blob_url ?? null,
    })),
  };
}

function sanitiseTree(raw) {
  return {
    sha: raw.sha,
    truncated: Boolean(raw.truncated),
    tree: (raw.tree ?? []).map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha,
      ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    })),
  };
}

/** Evenly spaced indices, always including the first and last. */
function spread(count, slots) {
  if (count <= slots) return Array.from({ length: count }, (_, i) => i);
  const out = new Set([0, count - 1]);
  for (let i = 1; i < slots - 1; i += 1) out.add(Math.round((i * (count - 1)) / (slots - 1)));
  return [...out].sort((a, b) => a - b);
}

async function record(owner, repo, { treeSlots, detailSlots, maxCommits }) {
  process.stdout.write(`recording ${owner}/${repo}\n`);
  const { data: repoRaw } = await gh(`/repos/${owner}/${repo}`);
  const branch = repoRaw.default_branch;

  const commits = [];
  const pages = lastPage((await gh(`/repos/${owner}/${repo}/commits`, { sha: branch, per_page: 1 })).link);
  const pageCount = Math.ceil(Math.min(pages, maxCommits) / 100);
  for (let page = 1; page <= pageCount; page += 1) {
    const { data } = await gh(`/repos/${owner}/${repo}/commits`, { sha: branch, per_page: 100, page });
    commits.push(...data.map(sanitiseCommit));
  }
  commits.length = Math.min(commits.length, maxCommits);

  // Oldest first for choosing checkpoints, then stored newest first like the API.
  const oldestFirst = [...commits].reverse();
  const treeIndices = spread(oldestFirst.length, treeSlots);
  const detailIndices = spread(oldestFirst.length, detailSlots);

  const tree = {};
  for (const index of treeIndices) {
    const sha = oldestFirst[index].sha;
    const { data } = await gh(`/repos/${owner}/${repo}/git/trees/${sha}`, { recursive: 1 });
    tree[sha] = sanitiseTree(data);
  }

  const commitDetail = {};
  for (const index of detailIndices) {
    const sha = oldestFirst[index].sha;
    const { data } = await gh(`/repos/${owner}/${repo}/commits/${sha}`);
    commitDetail[sha] = sanitiseDetail(data);
  }

  const { data: tags } = await gh(`/repos/${owner}/${repo}/tags`, { per_page: 100 });

  return {
    repo: sanitiseRepo(repoRaw),
    commits,
    commitDetail,
    tree,
    tags: (tags ?? []).map((tag) => ({ name: tag.name, commit: { sha: tag.commit.sha } })),
  };
}

// --------------------------------------------------------------- synthetic ---

const hash = (seed) => {
  // Deterministic 40-character hex, so regenerating fixtures is a no-op.
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
};

function syntheticRepo(name, overrides = {}) {
  return {
    name,
    full_name: `rtm-fixtures/${name}`,
    owner: { login: 'rtm-fixtures' },
    description: 'Synthetic fixture repository used by the automated tests.',
    default_branch: 'main',
    html_url: `https://github.com/rtm-fixtures/${name}`,
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: '2026-01-02T00:00:00Z',
    language: 'TypeScript',
    stargazers_count: 0,
    forks_count: 0,
    size: 12,
    license: null,
    topics: [],
    archived: false,
    fork: false,
    ...overrides,
  };
}

function oneCommitBundle() {
  const sha = hash('one-commit');
  const commit = {
    sha,
    html_url: `https://github.com/rtm-fixtures/one-commit/commit/${sha}`,
    commit: {
      message: 'Initial commit\n\nThe only commit this repository will ever have.',
      author: { name: 'Fixture Author', date: '2026-01-01T09:00:00Z' },
      committer: { name: 'Fixture Author', date: '2026-01-01T09:00:00Z' },
    },
    author: { login: 'fixture-author', avatar_url: null },
    parents: [],
  };
  return {
    repo: syntheticRepo('one-commit'),
    commits: [commit],
    commitDetail: {
      [sha]: {
        ...commit,
        stats: { additions: 3, deletions: 0, total: 3 },
        files: [
          {
            filename: 'README.md',
            previous_filename: null,
            status: 'added',
            additions: 3,
            deletions: 0,
            changes: 3,
            patch: '@@ -0,0 +1,3 @@\n+# one-commit\n+\n+A repository with exactly one commit.',
            blob_url: 'https://github.com/rtm-fixtures/one-commit/blob/main/README.md',
          },
        ],
      },
    },
    tree: {
      [sha]: {
        sha: hash('one-commit-tree'),
        truncated: false,
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: hash('readme'), size: 58 }],
      },
    },
    tags: [],
  };
}

function emptyBundle() {
  return {
    repo: syntheticRepo('empty-repo', { size: 0, language: null, pushed_at: null }),
    commits: [],
    commitDetail: {},
    tree: {},
    tags: [],
  };
}

/**
 * A long synthetic history for the pagination and virtualisation tests. Written
 * by rule rather than recorded, so it stays a few hundred kilobytes.
 */
function bigHistoryBundle(total = 640) {
  const areas = ['src/app', 'src/lib', 'src/components', 'tests', 'docs'];
  const commits = [];
  const start = Date.UTC(2024, 0, 8, 9, 0, 0);

  for (let i = 0; i < total; i += 1) {
    const sha = hash(`big:${i}`);
    const parents = i === 0 ? [] : [hash(`big:${i - 1}`)];
    if (i > 0 && i % 90 === 0) parents.push(hash(`big:branch:${i}`));
    const date = new Date(start + i * 7.4 * 3600 * 1000).toISOString();
    const area = areas[i % areas.length];
    commits.push({
      sha,
      html_url: `https://github.com/rtm-fixtures/big-history/commit/${sha}`,
      commit: {
        message:
          i === 0
            ? 'Initial commit'
            : i % 90 === 0
              ? `Merge pull request #${i / 90} from feature/step-${i}`
              : `${['feat', 'fix', 'refactor', 'test', 'docs'][i % 5]}(${area.split('/').pop()}): step ${i}`,
        author: { name: `Author ${i % 4}`, date },
        committer: { name: `Author ${i % 4}`, date },
      },
      author: { login: `author-${i % 4}`, avatar_url: null },
      parents: parents.map((sha) => ({ sha })),
    });
  }

  // Newest first, as GitHub returns them.
  commits.reverse();

  const paths = [];
  for (let i = 0; i < total; i += 1) {
    paths.push(`${areas[i % areas.length]}/module-${String(i).padStart(3, '0')}.ts`);
  }
  paths.push('README.md', 'package.json', 'tsconfig.json', '.github/workflows/ci.yml');

  const treeFor = (count) => ({
    sha: hash(`big-tree:${count}`),
    truncated: false,
    tree: paths.slice(0, count).map((p, i) => ({
      path: p,
      mode: '100644',
      type: 'blob',
      sha: hash(`blob:${p}`),
      size: 400 + ((i * 37) % 5000),
    })),
  });

  const tree = {};
  const oldestFirst = [...commits].reverse();
  for (const index of spread(total, 5)) {
    tree[oldestFirst[index].sha] = treeFor(Math.max(1, Math.round(((index + 1) / total) * paths.length)));
  }

  const commitDetail = {};
  for (const index of spread(total, 40)) {
    const commit = oldestFirst[index];
    const file = paths[index % paths.length];
    commitDetail[commit.sha] = {
      ...commit,
      stats: { additions: 12 + (index % 40), deletions: index % 9, total: 12 + (index % 40) + (index % 9) },
      files: [
        {
          filename: file,
          previous_filename: null,
          status: index === 0 ? 'added' : 'modified',
          additions: 12 + (index % 40),
          deletions: index % 9,
          changes: 12 + (index % 40) + (index % 9),
          patch: `@@ -1,3 +1,4 @@\n context line\n-old line ${index}\n+new line ${index}\n+another line ${index}`,
          blob_url: `https://github.com/rtm-fixtures/big-history/blob/main/${file}`,
        },
      ],
    };
  }

  return {
    repo: syntheticRepo('big-history', { size: 4200 }),
    commits,
    commitDetail,
    tree,
    tags: [
      { name: 'v1.0.0', commit: { sha: oldestFirst[Math.floor(total / 3)].sha } },
      { name: 'v2.0.0', commit: { sha: oldestFirst[Math.floor((total * 2) / 3)].sha } },
    ],
  };
}

// -------------------------------------------------------------------- main ---

async function writeBundle(directory, bundle) {
  await mkdir(path.join(ROOT, directory), { recursive: true });
  const file = path.join(ROOT, directory, 'bundle.json');
  await writeFile(file, `${JSON.stringify(bundle)}\n`, 'utf8');
  const bytes = Buffer.byteLength(JSON.stringify(bundle));
  process.stdout.write(`  ${directory}/bundle.json  ${(bytes / 1024).toFixed(0)} kB\n`);
}

async function main() {
  await mkdir(ROOT, { recursive: true });

  const index = {
    'rtm-fixtures/one-commit': 'one-commit',
    'rtm-fixtures/empty-repo': 'empty-repo',
    'rtm-fixtures/big-history': 'big-history',
    // Directives that make the server produce a specific failure.
    'rtm-fixtures/rate-limited': '__error:rate-limited',
    'rtm-fixtures/private-repo': '__error:private',
    'rtm-fixtures/slow-repo': '__error:timeout',
  };

  await writeBundle('one-commit', oneCommitBundle());
  await writeBundle('empty-repo', emptyBundle());
  await writeBundle('big-history', bigHistoryBundle());

  if (process.env.RTM_SKIP_NETWORK === '1') {
    process.stdout.write('skipping recorded repositories (RTM_SKIP_NETWORK=1)\n');
  } else {
    const recorded = [
      ['renrenmimi', 'renren-across-tabs', { treeSlots: 5, detailSlots: 5, maxCommits: 100 }],
      ['renrenmimi', 'DrillLab', { treeSlots: 6, detailSlots: 14, maxCommits: 100 }],
    ];
    for (const [owner, repo, options] of recorded) {
      const bundle = await record(owner, repo, options);
      const directory = repo.toLowerCase();
      await writeBundle(directory, bundle);
      index[`${owner}/${repo}`.toLowerCase()] = directory;
    }
  }

  await writeFile(path.join(ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  process.stdout.write('fixtures written\n');
}

await main();
