#!/usr/bin/env node
/**
 * Optional live smoke test against the real GitHub API.
 *
 * Deliberately separate from `npm test`: the standard suite must never depend on
 * GitHub's availability or spend rate limit. Run this by hand when you want to
 * confirm the adapter still matches what GitHub actually returns.
 *
 *     npm run build && npx next start -p 3311 &
 *     RTM_BASE_URL=http://127.0.0.1:3311 npm run test:live
 *
 * With a token it uses about ten requests; without one, the same ten come out
 * of the 60/hour anonymous allowance.
 */

const BASE = (process.env.RTM_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
/**
 * A neutral, public test repository owned by GitHub itself. Override with
 * RTM_LIVE_REPO to check a different one; nothing personal is used by default.
 */
const REPO = process.env.RTM_LIVE_REPO ?? 'octocat/Hello-World';
const [OWNER, NAME] = REPO.split('/');

let failures = 0;

function check(name, condition, detail = '') {
  const mark = condition ? 'ok  ' : 'FAIL';
  process.stdout.write(`${mark} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!condition) failures += 1;
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { status: response.status, headers: response.headers, body };
}

async function main() {
  process.stdout.write(`live smoke test against ${BASE}, repository ${REPO}\n\n`);

  const repo = await get(`/api/gh/repo?owner=${OWNER}&repo=${NAME}`);
  check('repository metadata loads', repo.status === 200, `status ${repo.status}`);
  if (repo.status !== 200) {
    process.stdout.write(`\n${JSON.stringify(repo.body, null, 2)}\n`);
    process.exit(1);
  }

  const meta = repo.body.data.meta;
  check('slug matches what was asked for', meta.slug.toLowerCase() === REPO.toLowerCase(), meta.slug);
  check('default branch is present', typeof meta.defaultBranch === 'string' && meta.defaultBranch.length > 0, meta.defaultBranch);
  check('no token value appears in the response', !/gh[posru]_[A-Za-z0-9]{10,}/.test(JSON.stringify(repo.body)));
  process.stdout.write(`     token configured server-side: ${repo.body.data.tokenConfigured}\n`);
  if (repo.body.rateLimit) {
    const { remaining, limit, authenticated } = repo.body.rateLimit;
    process.stdout.write(`     rate limit: ${remaining}/${limit} (${authenticated ? 'authenticated' : 'anonymous'})\n`);
  }

  const commits = await get(`/api/gh/commits?owner=${OWNER}&repo=${NAME}&branch=${meta.defaultBranch}&page=1`);
  check('commit page loads', commits.status === 200, `status ${commits.status}`);
  const list = commits.body?.data?.commits ?? [];
  check('commit page is not empty', list.length > 0, `${list.length} commits`);
  check('an exact commit count was determined', typeof commits.body?.data?.totalCommits === 'number', String(commits.body?.data?.totalCommits));

  const dates = list.map((commit) => Date.parse(commit.author.date));
  check('commits come back newest first', dates.every((value, i) => i === 0 || value <= dates[i - 1]));
  check('every commit has a sha, subject and author', list.every((c) => c.sha && c.subject && c.author?.name));

  const newest = list[0];
  const oldest = list.at(-1);

  const detail = await get(`/api/gh/commit?owner=${OWNER}&repo=${NAME}&sha=${newest.sha}`);
  check('commit diff loads', detail.status === 200, `status ${detail.status}`);
  const files = detail.body?.data?.detail?.files ?? [];
  check('diff lists files', files.length > 0, `${files.length} files`);
  check('patches respect the length cap', files.every((f) => (f.patch?.length ?? 0) <= 12_000));
  check(
    'every file without a patch says why',
    files.every((f) => f.patch !== null || f.patchOmittedReason !== null),
  );

  const tree = await get(`/api/gh/tree?owner=${OWNER}&repo=${NAME}&sha=${oldest.sha}`);
  check('tree loads at the oldest commit in the page', tree.status === 200, `status ${tree.status}`);
  const entries = tree.body?.data?.tree?.entries ?? [];
  check('tree has entries', entries.length > 0, `${entries.length} entries`);
  check('tree entries are blobs or trees only', entries.every((e) => e.type === 'blob' || e.type === 'tree'));

  const tags = await get(`/api/gh/tags?owner=${OWNER}&repo=${NAME}`);
  check('tags endpoint answers', tags.status === 200, `status ${tags.status}`);

  const probe = await get(`/api/gh/probe?owner=${OWNER}&repo=${NAME}&branch=${meta.defaultBranch}&path=README.md`);
  check('path probe answers', probe.status === 200 || probe.status === 404, `status ${probe.status}`);

  const missing = await get('/api/gh/repo?owner=octocat&repo=this-repository-does-not-exist-rtm');
  check('a missing repository is reported as not found', missing.status === 404, `status ${missing.status}`);

  const bad = await get('/api/gh/repo?owner=..%2F..&repo=x');
  check('a malformed owner is rejected before any request', bad.status === 400, `status ${bad.status}`);

  // The built-in demo must answer without GitHub, in every environment.
  const demo = await get('/api/gh/repo?owner=demo&repo=learning-platform');
  check('the built-in demo resolves locally', demo.status === 200, `status ${demo.status}`);
  check('the built-in demo declares itself built-in', demo.body?.data?.meta?.dataSource === 'builtin');
  check('the built-in demo has no repository URL', demo.body?.data?.meta?.htmlUrl === null);

  const unknownDemo = await get('/api/gh/repo?owner=demo&repo=not-a-real-demo');
  check(
    'an unknown demo reference falls through to the normal not-found path',
    unknownDemo.status === 404,
    `status ${unknownDemo.status}`,
  );

  process.stdout.write(`\n${failures === 0 ? 'all live checks passed' : `${failures} live check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
