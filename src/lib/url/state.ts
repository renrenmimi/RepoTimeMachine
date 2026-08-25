import { isValidSha, parseRepoRef, type RepoRef } from '@/lib/repo-ref';

/** The part of the application state that lives in the address bar. */
export type AppUrlState = {
  repo: RepoRef | null;
  /** Full or abbreviated sha of the selected commit. */
  commit: string | null;
};

export const REPO_PARAM = 'repo';
export const COMMIT_PARAM = 'c';

/** Reads state from a query string, ignoring anything malformed. */
export function parseAppUrl(search: string | URLSearchParams): AppUrlState {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;

  const repoValue = params.get(REPO_PARAM);
  const parsed = repoValue ? parseRepoRef(repoValue) : null;
  const repo = parsed && parsed.ok ? parsed.value : null;

  const commitValue = (params.get(COMMIT_PARAM) ?? '').toLowerCase();
  const commit = repo && isValidSha(commitValue) ? commitValue : null;

  return { repo, commit };
}

/** Builds the canonical query string for a state. Empty string means the home view. */
export function buildAppUrl(state: AppUrlState): string {
  if (!state.repo) return '/';
  const params = new URLSearchParams();
  params.set(REPO_PARAM, state.repo.slug);
  if (state.commit && isValidSha(state.commit)) params.set(COMMIT_PARAM, state.commit.slice(0, 10));
  return `/?${params.toString()}`;
}

export function sameUrlState(a: AppUrlState, b: AppUrlState): boolean {
  return a.repo?.slug === b.repo?.slug && (a.commit ?? null) === (b.commit ?? null);
}
