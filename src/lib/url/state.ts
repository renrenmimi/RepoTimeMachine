import { isValidSha, parseRepoRef, type RepoRef } from '@/lib/repo-ref';

/** The part of the application state that lives in the address bar. */
export type AppUrlState = {
  repo: RepoRef | null;
  /** Full or abbreviated sha of the selected commit, for the timeline view. */
  commit: string | null;
  /**
   * The two ends of a comparison. Present only in the compare view, which is a
   * different question from "where is the playhead" and so a different parameter.
   *
   * Optional so that callers describing a timeline state can simply omit it;
   * `parseAppUrl` always sets it explicitly.
   */
  compare?: { base: string; head: string } | null;
};

export const REPO_PARAM = 'repo';
export const COMMIT_PARAM = 'c';
export const COMPARE_BASE_PARAM = 'base';
export const COMPARE_HEAD_PARAM = 'head';

const abbreviate = (sha: string): string => sha.slice(0, 10);

/** Reads state from a query string, ignoring anything malformed. */
export function parseAppUrl(search: string | URLSearchParams): AppUrlState {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;

  const repoValue = params.get(REPO_PARAM);
  const parsed = repoValue ? parseRepoRef(repoValue) : null;
  const repo = parsed && parsed.ok ? parsed.value : null;

  const commitValue = (params.get(COMMIT_PARAM) ?? '').toLowerCase();
  const commit = repo && isValidSha(commitValue) ? commitValue : null;

  const baseValue = (params.get(COMPARE_BASE_PARAM) ?? '').toLowerCase();
  const headValue = (params.get(COMPARE_HEAD_PARAM) ?? '').toLowerCase();
  // A comparison needs both ends; one alone describes nothing.
  const compare =
    repo && isValidSha(baseValue) && isValidSha(headValue)
      ? { base: baseValue, head: headValue }
      : null;

  return { repo, commit, compare };
}

/** Builds the canonical query string for a state. `/` means the home view. */
export function buildAppUrl(state: AppUrlState): string {
  if (!state.repo) return '/';
  const params = new URLSearchParams();
  params.set(REPO_PARAM, state.repo.slug);

  if (state.compare && isValidSha(state.compare.base) && isValidSha(state.compare.head)) {
    // The compare view replaces the playhead rather than sitting alongside it,
    // so a shared link opens in exactly one of the two.
    params.set(COMPARE_BASE_PARAM, abbreviate(state.compare.base));
    params.set(COMPARE_HEAD_PARAM, abbreviate(state.compare.head));
    return `/?${params.toString()}`;
  }

  if (state.commit && isValidSha(state.commit)) params.set(COMMIT_PARAM, abbreviate(state.commit));
  return `/?${params.toString()}`;
}

export function sameUrlState(a: AppUrlState, b: AppUrlState): boolean {
  return (
    a.repo?.slug === b.repo?.slug &&
    (a.commit ?? null) === (b.commit ?? null) &&
    (a.compare?.base ?? null) === (b.compare?.base ?? null) &&
    (a.compare?.head ?? null) === (b.compare?.head ?? null)
  );
}
