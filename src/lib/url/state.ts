import { isValidSha, parseRepoRef, type RepoRef } from '@/lib/repo-ref';

/**
 * The three questions the application answers. One is open at a time, and which
 * one is part of the shareable state.
 */
export type AppView = 'replay' | 'compare' | 'insights';

export const APP_VIEWS: readonly AppView[] = ['replay', 'compare', 'insights'];

export function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (APP_VIEWS as readonly string[]).includes(value);
}

/** The part of the application state that lives in the address bar. */
export type AppUrlState = {
  repo: RepoRef | null;
  /** Full or abbreviated sha of the selected commit, for the replay view. */
  commit: string | null;
  /**
   * The two ends of a comparison. Present only for the compare view, which is a
   * different question from "where is the playhead" and so a different parameter.
   *
   * Optional so that callers describing a replay state can simply omit it;
   * `parseAppUrl` always sets it explicitly.
   */
  compare?: { base: string; head: string } | null;
  /**
   * Which view is open.
   *
   * Optional on the way in: a link that carries `base`/`head` describes a
   * comparison whether or not it names the view, and one that carries only `c`
   * describes a replay position. `parseAppUrl` always resolves it.
   */
  view?: AppView | null;
};

export const REPO_PARAM = 'repo';
export const COMMIT_PARAM = 'c';
export const COMPARE_BASE_PARAM = 'base';
export const COMPARE_HEAD_PARAM = 'head';
export const VIEW_PARAM = 'view';

const abbreviate = (sha: string): string => sha.slice(0, 10);

/** The fully resolved form: nothing here is optional or ambiguous. */
export type ParsedAppUrl = {
  repo: RepoRef | null;
  commit: string | null;
  compare: { base: string; head: string } | null;
  /** Always resolved: an absent or unrecognised value becomes `replay`. */
  view: AppView;
};

/**
 * Reads state from a query string, ignoring anything malformed.
 *
 * Every parameter is optional and every unknown value falls back rather than
 * failing, because these strings arrive from other people's links.
 */
export function parseAppUrl(search: string | URLSearchParams): ParsedAppUrl {
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

  /*
   * A pair of endpoints implies the compare view even in a link written before
   * `view` existed, which is what keeps every already-shared comparison working.
   * An unrecognised value is discarded rather than honoured.
   */
  const requested = params.get(VIEW_PARAM);
  const view: AppView = !repo
    ? 'replay'
    : compare
      ? 'compare'
      : isAppView(requested) && requested !== 'compare'
        ? requested
        : 'replay';

  return { repo, commit, compare, view };
}

/** Builds the canonical query string for a state. `/` means the home view. */
export function buildAppUrl(state: AppUrlState): string {
  if (!state.repo) return '/';
  const params = new URLSearchParams();
  params.set(REPO_PARAM, state.repo.slug);

  if (state.compare && isValidSha(state.compare.base) && isValidSha(state.compare.head)) {
    /*
     * A valid pair of endpoints *is* what makes a link a comparison — the same
     * rule `parseAppUrl` applies, so the two are exact inverses. `view` is left
     * off deliberately: the endpoints already say which view this is, and
     * omitting it keeps the links this application has already handed out
     * byte-identical.
     *
     * The compare view replaces the playhead rather than sitting alongside it,
     * so a shared link opens in exactly one of the two.
     */
    params.set(COMPARE_BASE_PARAM, abbreviate(state.compare.base));
    params.set(COMPARE_HEAD_PARAM, abbreviate(state.compare.head));
    return `/?${params.toString()}`;
  }

  // The playhead is meaningful in insights too — it is where Replay returns to.
  if (state.commit && isValidSha(state.commit)) params.set(COMMIT_PARAM, abbreviate(state.commit));
  // `replay` is the default, so naming it would only lengthen every link.
  if (state.view === 'insights') params.set(VIEW_PARAM, state.view);
  return `/?${params.toString()}`;
}

export function sameUrlState(a: AppUrlState, b: AppUrlState): boolean {
  return (
    a.repo?.slug === b.repo?.slug &&
    (a.commit ?? null) === (b.commit ?? null) &&
    (a.compare?.base ?? null) === (b.compare?.base ?? null) &&
    (a.compare?.head ?? null) === (b.compare?.head ?? null) &&
    (a.view ?? 'replay') === (b.view ?? 'replay')
  );
}
