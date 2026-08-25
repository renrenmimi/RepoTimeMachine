import 'server-only';

import { BUILTIN_DEMO_SLUG } from '@/lib/builtin/learning-platform';
import {
  builtinCommitDetail,
  builtinCommitPage,
  builtinFirstCommitForPath,
  builtinRepoMeta,
  builtinTags,
  builtinTree,
  isBuiltinRef,
  isUnknownBuiltinRef,
} from '@/lib/builtin/provider';
import type { Commit, CommitDetail, RepoMeta, RepoTree, Tag } from '@/lib/domain/types';
import type { RepoRef } from '@/lib/repo-ref';
import { toCommit, toCommitDetail, toRepoMeta, toRepoTree, toTags } from './adapter';
import { githubFetch, pageFromLink } from './client';
import { GitHubError } from './errors';
import { fixtureCommitDetail, fixtureTree } from './fixture-bundle';
import { loadFixtures, fixtureModeEnabled } from './fixtures';
import { recordRateLimit } from './rate-limit-store';
import type { RawCommitDetail, RawCommitListItem, RawRepo, RawTag, RawTree } from './raw-types';

/** Cache lifetimes, in seconds. Sha-addressed data is immutable, so it can live for a day. */
export const REVALIDATE = {
  repo: 300,
  commits: 300,
  commitDetail: 86_400,
  tree: 86_400,
  tags: 600,
  probe: 3_600,
} as const;

export const COMMITS_PER_PAGE = 100;
/** Hard ceiling on how far back a visitor can page, so one visitor cannot drain the quota. */
export const MAX_COMMIT_PAGES = 10;

/**
 * Decides whether a reference is served from the built-in fixture.
 *
 * Returning `true` means "answer locally". Throwing means the reference names the
 * reserved `demo` namespace but is not the built-in demo, so it is a repository
 * that cannot exist and no request should be made for it. Every function below
 * asks this one question first, so neither branch can be skipped for one endpoint.
 */
function servedFromBuiltin(ref: RepoRef): boolean {
  if (isBuiltinRef(ref)) return true;
  if (isUnknownBuiltinRef(ref)) {
    throw new GitHubError(
      'not-found',
      `"${ref.slug}" is not a repository. The "demo" namespace is built into this application and holds only ${BUILTIN_DEMO_SLUG}.`,
      { origin: 'local' },
    );
  }
  return false;
}

async function request<T>(args: Parameters<typeof githubFetch<T>>[0]) {
  const response = await githubFetch<T>(args);
  recordRateLimit(response.rateLimit);
  return response;
}

export async function fetchRepoMeta(ref: RepoRef): Promise<RepoMeta> {
  // The built-in demo is resolved before anything else, in every environment,
  // so it can never reach api.github.com or be sent a token.
  if (servedFromBuiltin(ref)) return builtinRepoMeta();
  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    return toRepoMeta(fixtures.repo, fixtures.commits.length === 0);
  }
  const { data } = await request<RawRepo>({
    segments: ['repos', ref.owner, ref.repo],
    revalidate: REVALIDATE.repo,
  });
  if (!data) throw new GitHubError('not-found', 'That repository could not be found.');
  // `size === 0` is GitHub's signal for a repository with no pushed content yet.
  return toRepoMeta(data, data.size === 0);
}

export type CommitsResult = {
  commits: Commit[];
  hasOlder: boolean;
  totalCommits: number | null;
};

/**
 * One page of commits, newest first.
 *
 * On page 1 we also spend one very small extra request (`per_page=1`) whose
 * `Link: rel="last"` header is the exact commit count. That is what lets the UI
 * say "showing the latest 100 of 1,204" instead of guessing.
 */
export async function fetchCommitPage(
  ref: RepoRef,
  branch: string,
  page: number,
): Promise<CommitsResult> {
  const safePage = Math.min(Math.max(1, Math.floor(page)), MAX_COMMIT_PAGES);

  if (servedFromBuiltin(ref)) return builtinCommitPage(safePage, COMMITS_PER_PAGE);

  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    const start = (safePage - 1) * COMMITS_PER_PAGE;
    const slice = fixtures.commits.slice(start, start + COMMITS_PER_PAGE);
    return {
      commits: slice.map((raw, i) => toCommit(raw, start + i)),
      hasOlder: start + slice.length < fixtures.commits.length,
      totalCommits: fixtures.commits.length,
    };
  }

  const listPromise = request<RawCommitListItem[]>({
    segments: ['repos', ref.owner, ref.repo, 'commits'],
    query: { sha: branch, per_page: COMMITS_PER_PAGE, page: safePage },
    revalidate: REVALIDATE.commits,
  });

  const countPromise = safePage === 1 ? countCommits(ref, branch) : Promise.resolve(null);
  const [list, totalCommits] = await Promise.all([listPromise, countPromise]);

  const items = Array.isArray(list.data) ? list.data : [];
  return {
    commits: items.map((raw, i) => toCommit(raw, (safePage - 1) * COMMITS_PER_PAGE + i)),
    hasOlder: Boolean(list.links.next),
    totalCommits,
  };
}

/** Exact commit count via the pagination header. Failure is never fatal. */
async function countCommits(ref: RepoRef, branch: string): Promise<number | null> {
  try {
    const { data, links } = await request<RawCommitListItem[]>({
      segments: ['repos', ref.owner, ref.repo, 'commits'],
      query: { sha: branch, per_page: 1 },
      revalidate: REVALIDATE.commits,
    });
    const last = pageFromLink(links.last);
    if (last !== null) return last;
    return Array.isArray(data) ? data.length : null;
  } catch {
    return null;
  }
}

export async function fetchCommitDetail(ref: RepoRef, sha: string): Promise<CommitDetail> {
  if (servedFromBuiltin(ref)) {
    const detail = builtinCommitDetail(sha);
    if (!detail) {
      throw new GitHubError('not-found', 'That commit is not part of the built-in demo.', { origin: 'local' });
    }
    return detail;
  }
  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    const raw = fixtureCommitDetail(fixtures, sha);
    if (!raw) throw new GitHubError('not-found', 'No fixture recorded for that commit.', { origin: 'local' });
    return toCommitDetail(raw);
  }
  const { data } = await request<RawCommitDetail>({
    segments: ['repos', ref.owner, ref.repo, 'commits', sha],
    revalidate: REVALIDATE.commitDetail,
  });
  if (!data) throw new GitHubError('not-found', 'That commit could not be found.');
  return toCommitDetail(data);
}

export async function fetchTree(ref: RepoRef, sha: string): Promise<RepoTree> {
  if (servedFromBuiltin(ref)) {
    const tree = builtinTree(sha);
    if (!tree) {
      throw new GitHubError('not-found', 'That commit is not part of the built-in demo.', { origin: 'local' });
    }
    return tree;
  }
  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    const raw = fixtureTree(fixtures, sha);
    if (!raw) {
      throw new GitHubError('not-found', 'No tree fixture recorded for that commit.', { origin: 'local' });
    }
    return toRepoTree(raw, sha);
  }
  const { data } = await request<RawTree>({
    segments: ['repos', ref.owner, ref.repo, 'git', 'trees', sha],
    query: { recursive: '1' },
    revalidate: REVALIDATE.tree,
  });
  if (!data) throw new GitHubError('not-found', 'That tree could not be found.');
  return toRepoTree(data, sha);
}

export async function fetchTags(ref: RepoRef): Promise<Tag[]> {
  if (servedFromBuiltin(ref)) return builtinTags();
  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    return toTags(fixtures.tags);
  }
  try {
    const { data } = await request<RawTag[]>({
      segments: ['repos', ref.owner, ref.repo, 'tags'],
      query: { per_page: 100 },
      revalidate: REVALIDATE.tags,
    });
    return toTags(Array.isArray(data) ? data : []);
  } catch (error) {
    // Tags are decorative: a repository without them, or a hiccup here, must not
    // break the timeline.
    if (error instanceof GitHubError && error.code === 'rate-limited') throw error;
    return [];
  }
}

/**
 * Finds the oldest commit that touched a path, using the path-scoped commit
 * listing. Costs one request, or two when the path has a long history.
 */
export async function probeFirstCommitForPath(
  ref: RepoRef,
  branch: string,
  path: string,
): Promise<{ firstSha: string | null; incomplete: boolean }> {
  if (servedFromBuiltin(ref)) return { firstSha: builtinFirstCommitForPath(path), incomplete: false };
  if (fixtureModeEnabled()) {
    const fixtures = await loadFixtures(ref);
    const touching = fixtures.commits.filter((commit) => {
      const detail = fixtures.commitDetail[commit.sha];
      return detail?.files.some((file) => file.filename === path || file.previous_filename === path);
    });
    const oldest = touching[touching.length - 1];
    return { firstSha: oldest?.sha ?? null, incomplete: false };
  }

  const first = await request<RawCommitListItem[]>({
    segments: ['repos', ref.owner, ref.repo, 'commits'],
    query: { sha: branch, path, per_page: COMMITS_PER_PAGE },
    revalidate: REVALIDATE.probe,
  });
  const lastPage = pageFromLink(first.links.last);

  if (lastPage === null) {
    const items = Array.isArray(first.data) ? first.data : [];
    return { firstSha: items[items.length - 1]?.sha ?? null, incomplete: false };
  }

  // Long history for this path: one more request lands on the oldest page.
  if (lastPage > 20) return { firstSha: null, incomplete: true };
  const last = await request<RawCommitListItem[]>({
    segments: ['repos', ref.owner, ref.repo, 'commits'],
    query: { sha: branch, path, per_page: COMMITS_PER_PAGE, page: lastPage },
    revalidate: REVALIDATE.probe,
  });
  const items = Array.isArray(last.data) ? last.data : [];
  return { firstSha: items[items.length - 1]?.sha ?? null, incomplete: false };
}
