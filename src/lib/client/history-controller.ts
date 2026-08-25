import { DedupedCache } from '@/lib/cache/lru';
import type { Commit, CommitDetail, RateLimitSnapshot, RepoMeta, RepoTree, Tag } from '@/lib/domain/types';
import { detectMilestones, type Milestone } from '@/lib/milestones/detect';
import { SIGNATURES } from '@/lib/milestones/signatures';
import {
  initialPlaybackState,
  playbackReducer,
  type PlaybackAction,
  type PlaybackState,
} from '@/lib/playback/machine';
import type { RepoRef } from '@/lib/repo-ref';
import {
  buildActivityMap,
  buildGrowthSeries,
  type ActivityMap,
  type GrowthSeries,
} from '@/lib/stats/growth';
import { TreeProjector } from '@/lib/tree/projector';
import { ApiError, browserApi, type ApiErrorInfo, type GitHubApi } from './api';

export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DensifyState = {
  active: boolean;
  /** Commit diffs loaded so far. */
  done: number;
  /** Commit diffs this session intends to load. */
  target: number;
  /** Why the target is lower than the loaded range, when it is. */
  limitReason: string | null;
};

export type HistoryState = {
  /** Bumped on every notification; use it as a memo dependency. */
  version: number;
  ref: RepoRef | null;
  status: HistoryStatus;
  error: ApiErrorInfo | null;
  meta: RepoMeta | null;
  tokenConfigured: boolean;
  /** Oldest first. `index` is relative to this array. */
  commits: Commit[];
  totalCommits: number | null;
  hasOlder: boolean;
  pagesLoaded: number;
  loadingOlder: boolean;
  tags: Tag[];
  rateLimit: RateLimitSnapshot | null;
  rateLimitAgeMs: number | null;
  snapshotCount: number;
  detailCount: number;
  densify: DensifyState;
  milestones: Milestone[];
  growth: GrowthSeries | null;
  activity: ActivityMap | null;
  /**
   * Playback lives here rather than in the component so that loading older
   * commits, which shifts every index, can move the playhead in the same update
   * that changes the range. There is no window where the two disagree.
   */
  playback: PlaybackState;
  /** Non-fatal problems worth telling the visitor about. */
  notices: string[];
};

export type ControllerOptions = {
  api?: GitHubApi;
  /** Test seam so timers do not have to be real. */
  scheduleRecompute?: (run: () => void) => () => void;
};

/** Pages fetched without the visitor asking. 3 pages = the latest 300 commits. */
export const AUTO_PAGES = 3;
export const MAX_PAGES = 10;
const PER_PAGE = 100;

/** Tree snapshots we are willing to prefetch, by token availability. */
const TREE_BUDGET = { authenticated: 10, anonymous: 3 };
/** Commit diffs we are willing to prefetch in the background. */
const DETAIL_BUDGET = { authenticated: 400, anonymous: 12 };
/** Stop background work when the remaining quota gets this low. */
const RATE_LIMIT_FLOOR = { authenticated: 60, anonymous: 12 };
const DETAIL_CONCURRENCY = 4;

const EMPTY_DENSIFY: DensifyState = { active: false, done: 0, target: 0, limitReason: null };

function initialState(): HistoryState {
  return {
    version: 0,
    ref: null,
    status: 'idle',
    error: null,
    meta: null,
    tokenConfigured: false,
    commits: [],
    totalCommits: null,
    hasOlder: false,
    pagesLoaded: 0,
    loadingOlder: false,
    tags: [],
    rateLimit: null,
    rateLimitAgeMs: null,
    snapshotCount: 0,
    detailCount: 0,
    densify: EMPTY_DENSIFY,
    milestones: [],
    growth: null,
    activity: null,
    playback: initialPlaybackState(),
    notices: [],
  };
}

/** Stable object for `useSyncExternalStore`'s server snapshot. */
export const EMPTY_HISTORY_STATE: HistoryState = Object.freeze(initialState());

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Owns every network request and every derived view of a repository's history.
 *
 * The controller is deliberately not a React hook: switching repositories,
 * cancelling stale work and budgeting requests against the GitHub rate limit
 * are easier to reason about — and to test — as plain asynchronous code.
 */
export class HistoryController {
  #state: HistoryState = initialState();
  #listeners = new Set<() => void>();
  #api: GitHubApi;
  #projector = new TreeProjector();

  /** Incremented on every repository switch; every continuation checks it. */
  #generation = 0;
  #abort: AbortController | null = null;

  #details = new Map<string, CommitDetail>();
  #snapshots = new Map<string, RepoTree>();
  #probes = new Map<string, string>();
  /** Trees GitHub refused; retrying them inside one session only wastes quota. */
  #failedTrees = new Set<string>();
  #treeCache = new DedupedCache<RepoTree>(64);
  #detailCache = new DedupedCache<CommitDetail>(600);

  /** Sha the visitor asked for through the URL, before commits have arrived. */
  #requestedSha: string | null = null;
  /** Sha currently selected, so the selection survives a change of range. */
  #selectedSha: string | null = null;

  /** Commit shas queued for background diff loading, highest priority first. */
  #priority: string[] = [];
  #densifying = false;
  #recomputeHandle: (() => void) | null = null;
  #scheduleRecompute: (run: () => void) => () => void;

  constructor(options: ControllerOptions = {}) {
    this.#api = options.api ?? browserApi;
    this.#scheduleRecompute =
      options.scheduleRecompute ??
      ((run) => {
        const id = setTimeout(run, 220);
        return () => clearTimeout(id);
      });
  }

  // ---------------------------------------------------------------- store ---

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = (): HistoryState => this.#state;

  get projector(): TreeProjector {
    return this.#projector;
  }

  get details(): ReadonlyMap<string, CommitDetail> {
    return this.#details;
  }

  #patch(patch: Partial<HistoryState>): void {
    this.#state = { ...this.#state, ...patch, version: this.#state.version + 1 };
    for (const listener of this.#listeners) listener();
  }

  #notice(message: string): void {
    if (this.#state.notices.includes(message)) return;
    this.#patch({ notices: [...this.#state.notices, message] });
  }

  #observeRateLimit = (snapshot: RateLimitSnapshot | null, ageMs: number | null): void => {
    if (!snapshot) return;
    this.#patch({ rateLimit: snapshot, rateLimitAgeMs: ageMs });
  };

  #fetchOptions() {
    return { signal: this.#abort?.signal, onRateLimit: this.#observeRateLimit };
  }

  #isStale(generation: number): boolean {
    return generation !== this.#generation;
  }

  // ---------------------------------------------------------------- budget ---

  #authenticated(): boolean {
    return this.#state.tokenConfigured || Boolean(this.#state.rateLimit?.authenticated);
  }

  /**
   * Built-in data costs nothing, so none of the GitHub budgets apply to it.
   * The demo loads completely for every visitor, with or without a token.
   */
  #isBuiltin(): boolean {
    return this.#state.meta?.dataSource === 'builtin';
  }

  #budget(table: { authenticated: number; anonymous: number }): number {
    if (this.#isBuiltin()) return Number.POSITIVE_INFINITY;
    return this.#authenticated() ? table.authenticated : table.anonymous;
  }

  /** True when background prefetching should stop to leave quota for real interactions. */
  #quotaExhausted(): boolean {
    if (this.#isBuiltin()) return false;
    const rateLimit = this.#state.rateLimit;
    if (!rateLimit) return false;
    const floor = this.#authenticated() ? RATE_LIMIT_FLOOR.authenticated : RATE_LIMIT_FLOOR.anonymous;
    return rateLimit.remaining <= floor;
  }

  // ------------------------------------------------------------------ load ---

  reset(): void {
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#projector.clear();
    this.#details.clear();
    this.#snapshots.clear();
    this.#probes.clear();
    this.#failedTrees.clear();
    this.#treeCache.clear();
    this.#detailCache.clear();
    this.#priority = [];
    this.#selectedSha = null;
    this.#requestedSha = null;
    this.#densifying = false;
    this.#recomputeHandle?.();
    this.#recomputeHandle = null;
    this.#state = { ...initialState(), version: this.#state.version + 1 };
    for (const listener of this.#listeners) listener();
  }

  /**
   * Loads a repository. `requestedSha` comes from a shared URL and selects that
   * commit once the range containing it has arrived.
   */
  async load(ref: RepoRef, requestedSha: string | null = null): Promise<void> {
    if (this.#state.ref?.slug === ref.slug && this.#state.status === 'ready') {
      if (requestedSha) this.selectSha(requestedSha);
      return;
    }

    this.reset();
    this.#requestedSha = requestedSha;
    const generation = this.#generation;
    this.#abort = new AbortController();
    this.#patch({ ref, status: 'loading' });

    try {
      const repo = await this.#api.fetchRepo(ref, this.#fetchOptions());
      if (this.#isStale(generation)) return;
      this.#patch({ meta: repo.meta, tokenConfigured: repo.tokenConfigured });

      if (repo.meta.isEmpty) {
        this.#patch({ status: 'ready', commits: [], totalCommits: 0 });
        return;
      }

      await this.#loadCommitPages(generation, ref, repo.meta.defaultBranch);
      if (this.#isStale(generation)) return;

      if (this.#state.commits.length === 0) {
        this.#patch({ status: 'ready' });
        return;
      }

      this.#patch({ status: 'ready' });
      // Metadata milestones (initial commit, merges, breaking-change markers)
      // need no further requests, so they are available immediately.
      this.#scheduleDerived();
      void this.#loadSupporting(generation, ref, repo.meta.defaultBranch);
    } catch (error) {
      if (isAbort(error) || this.#isStale(generation)) return;
      const info: ApiErrorInfo =
        error instanceof ApiError
          ? error.info
          : { code: 'unknown', message: 'Something went wrong loading this repository.', retryAt: null };
      this.#patch({ status: 'error', error: info });
    }
  }

  async #loadCommitPages(generation: number, ref: RepoRef, branch: string): Promise<void> {
    const newestFirst: Commit[] = [];
    let page = 1;
    let hasOlder = false;
    let totalCommits: number | null = null;

    while (page <= AUTO_PAGES) {
      const payload = await this.#api.fetchCommits(ref, branch, page, this.#fetchOptions());
      if (this.#isStale(generation)) return;
      newestFirst.push(...payload.commits);
      hasOlder = payload.hasOlder;
      if (payload.totalCommits !== null) totalCommits = payload.totalCommits;
      if (!payload.hasOlder) break;
      page += 1;
    }

    this.#commitRangeLoaded(newestFirst, { hasOlder, totalCommits, pagesLoaded: Math.min(page, AUTO_PAGES) });
  }

  #commitRangeLoaded(
    newestFirst: Commit[],
    meta: { hasOlder: boolean; totalCommits: number | null; pagesLoaded: number },
  ): void {
    const commits = [...newestFirst].reverse().map((commit, index) => ({ ...commit, index }));
    this.#projector.setCommits(commits);
    for (const [sha, tree] of this.#snapshots) this.#projector.addSnapshot(sha, tree);
    for (const [sha, detail] of this.#details) this.#projector.addDetail(sha, detail);
    const index = this.#chooseIndex(commits);
    this.#selectedSha = commits[index]?.sha ?? null;

    this.#patch({
      commits,
      hasOlder: meta.hasOlder,
      totalCommits: meta.totalCommits ?? this.#state.totalCommits,
      pagesLoaded: meta.pagesLoaded,
      playback: playbackReducer(this.#state.playback, { type: 'setCount', count: commits.length, index }),
    });
  }

  /**
   * Where the playhead should sit for a newly loaded range: the commit asked for
   * in the URL, else whatever was already selected, else the newest commit --
   * the repository as it stands today, which is the most familiar starting point.
   */
  #chooseIndex(commits: readonly Commit[]): number {
    if (commits.length === 0) return 0;
    if (this.#requestedSha) {
      const match = commits.find((commit) => commit.sha.startsWith(this.#requestedSha!));
      if (match) {
        this.#requestedSha = null;
        return match.index;
      }
    }
    if (this.#selectedSha) {
      const match = commits.find((commit) => commit.sha === this.#selectedSha);
      if (match) return match.index;
    }
    return commits.length - 1;
  }

  /** Applies a playback action and keeps the remembered selection in step. */
  dispatchPlayback = (action: PlaybackAction): void => {
    const playback = playbackReducer(this.#state.playback, action);
    if (playback === this.#state.playback) return;
    this.#selectedSha = this.#state.commits[playback.index]?.sha ?? this.#selectedSha;
    this.#patch({ playback });
  };

  /** Selects a commit by full or abbreviated sha, if it is in the loaded range. */
  selectSha(sha: string): boolean {
    const match = this.#state.commits.find((commit) => commit.sha.startsWith(sha));
    if (!match) {
      this.#requestedSha = sha;
      return false;
    }
    this.dispatchPlayback({ type: 'seek', index: match.index });
    return true;
  }

  /** The commit under the playhead, or null when nothing is loaded. */
  get currentCommit(): Commit | null {
    return this.#state.commits[this.#state.playback.index] ?? null;
  }

  /** Loads another page of older commits at the visitor's request. */
  async loadOlder(): Promise<void> {
    const { ref, meta, hasOlder, pagesLoaded, loadingOlder } = this.#state;
    if (!ref || !meta || !hasOlder || loadingOlder || pagesLoaded >= MAX_PAGES) return;

    const generation = this.#generation;
    this.#patch({ loadingOlder: true });
    try {
      const nextPage = pagesLoaded + 1;
      const payload = await this.#api.fetchCommits(ref, meta.defaultBranch, nextPage, this.#fetchOptions());
      if (this.#isStale(generation)) return;
      const newestFirst = [...this.#state.commits].reverse();
      newestFirst.push(...payload.commits);
      this.#commitRangeLoaded(newestFirst, {
        hasOlder: payload.hasOlder,
        totalCommits: payload.totalCommits,
        pagesLoaded: nextPage,
      });
      this.#patch({ loadingOlder: false });
      void this.#ensureCheckpointTrees(generation, ref);
      this.#queueDensify(generation, ref);
      this.#scheduleDerived();
    } catch (error) {
      if (isAbort(error) || this.#isStale(generation)) return;
      this.#patch({ loadingOlder: false });
      if (error instanceof ApiError) this.#notice(error.info.message);
    }
  }

  /**
   * Everything after the commit list, in the order the screen needs it.
   *
   * The first usable screen is the selected commit: its tree and its diff. Those
   * two go out together and nothing else is allowed to queue ahead of them.
   * Tags, the remaining checkpoints, background diffs and milestone probes follow.
   */
  async #loadSupporting(generation: number, ref: RepoRef, branch: string): Promise<void> {
    const commits = this.#state.commits;
    if (commits.length === 0) return;

    const selected = commits[this.#state.playback.index] ?? commits[commits.length - 1]!;
    await Promise.all([
      this.#ensureTree(generation, ref, selected.sha),
      this.ensureDetail(selected.sha),
    ]);
    if (this.#isStale(generation)) return;
    this.#scheduleDerived();

    void this.#loadTags(generation, ref);
    void this.#ensureCheckpointTrees(generation, ref);
    this.#queueDensify(generation, ref);
    void this.#runProbes(generation, ref, branch);
  }

  async #loadTags(generation: number, ref: RepoRef): Promise<void> {
    try {
      const payload = await this.#api.fetchTags(ref, this.#fetchOptions());
      if (this.#isStale(generation)) return;
      this.#patch({ tags: payload.tags });
      this.#scheduleDerived();
    } catch (error) {
      if (isAbort(error) || this.#isStale(generation)) return;
      this.#notice('Tags could not be loaded, so release milestones are missing.');
    }
  }

  /**
   * How many full trees are worth reading.
   *
   * A tree is only needed where diffs cannot reach. If every diff in the range is
   * going to be loaded anyway, a baseline at the oldest commit plus the one
   * already read at the selected commit makes every position exact, and further
   * trees would be spent for nothing.
   */
  #treeBudget(count: number): number {
    // Built-in trees are local, so reading one at every commit is free and makes
    // every position exact rather than rebuilt.
    if (this.#isBuiltin()) return count;
    if (count <= this.#budget(DETAIL_BUDGET)) return 2;
    return this.#budget(TREE_BUDGET);
  }

  async #ensureCheckpointTrees(generation: number, ref: RepoRef): Promise<void> {
    const commits = this.#state.commits;
    const budget = this.#treeBudget(commits.length);
    for (const index of planCheckpoints(commits.length, budget)) {
      if (this.#isStale(generation) || this.#quotaExhausted()) return;
      const sha = commits[index]?.sha;
      if (!sha || this.#snapshots.has(sha) || this.#failedTrees.has(sha)) continue;
      await this.#ensureTree(generation, ref, sha);
      this.#scheduleDerived();
    }
  }

  async #ensureTree(generation: number, ref: RepoRef, sha: string): Promise<RepoTree | null> {
    if (this.#snapshots.has(sha)) return this.#snapshots.get(sha)!;
    if (this.#failedTrees.has(sha)) return null;
    try {
      const tree = await this.#treeCache.load(`${ref.slug}:${sha}`, async () => {
        const payload = await this.#api.fetchTree(ref, sha, this.#fetchOptions());
        return payload.tree;
      });
      if (this.#isStale(generation)) return null;
      this.#snapshots.set(sha, tree);
      this.#projector.addSnapshot(sha, tree);
      this.#patch({ snapshotCount: this.#snapshots.size });
      if (tree.truncated) {
        this.#notice('GitHub truncated at least one file tree because the repository is very large.');
      }
      return tree;
    } catch (error) {
      if (isAbort(error) || this.#isStale(generation)) return null;
      this.#failedTrees.add(sha);
      if (error instanceof ApiError && error.info.code === 'rate-limited') {
        this.#notice(error.info.message);
      }
      return null;
    }
  }

  /**
   * Loads one commit's diff. Called on selection (immediately) and by the
   * background densifier (at low priority).
   */
  async ensureDetail(sha: string): Promise<CommitDetail | null> {
    const ref = this.#state.ref;
    if (!ref) return null;
    const generation = this.#generation;
    if (this.#details.has(sha)) return this.#details.get(sha)!;
    try {
      const detail = await this.#detailCache.load(`${ref.slug}:${sha}`, async () => {
        const payload = await this.#api.fetchCommitDetail(ref, sha, this.#fetchOptions());
        return payload.detail;
      });
      if (this.#isStale(generation)) return null;
      this.#details.set(sha, detail);
      this.#projector.addDetail(sha, detail);
      this.#patch({ detailCount: this.#details.size });
      return detail;
    } catch (error) {
      if (isAbort(error) || this.#isStale(generation)) return null;
      if (error instanceof ApiError && error.info.code === 'rate-limited') {
        this.#notice(error.info.message);
      }
      return null;
    }
  }

  /**
   * Reads the exact tree at one commit. One request buys an exact answer, so
   * this is used when the visitor settles on a commit rather than during playback.
   */
  async ensureExactTree(index: number): Promise<void> {
    const { ref, commits } = this.#state;
    const commit = commits[index];
    if (!ref || !commit) return;
    if (this.#projector.project(index).fidelity !== 'partial') return;
    if (this.#quotaExhausted()) return;
    await this.#ensureTree(this.#generation, ref, commit.sha);
    this.#scheduleDerived();
  }

  /** Moves a commit to the front of the background queue. */
  prioritise(sha: string): void {
    if (this.#details.has(sha)) return;
    this.#priority = [sha, ...this.#priority.filter((item) => item !== sha)].slice(0, 64);
  }

  #queueDensify(generation: number, ref: RepoRef): void {
    if (this.#densifying) return;
    void this.#densify(generation, ref);
  }

  /**
   * Background loading of commit diffs.
   *
   * Diffs are what make the file tree exact between checkpoints and what the
   * growth chart and several milestone rules need. They cost one request each,
   * so the number is budgeted against the rate limit and the work stops as soon
   * as the visitor switches repository.
   */
  async #densify(generation: number, _ref: RepoRef): Promise<void> {
    this.#densifying = true;
    try {
      const budget = this.#budget(DETAIL_BUDGET);
      const commits = this.#state.commits;
      const target = Number.isFinite(budget) ? Math.min(commits.length, budget) : commits.length;
      const limitReason =
        target < commits.length
          ? this.#authenticated()
            ? `Diffs are loaded for the ${target} most recent commits in range to keep request counts sane.`
            : `Without a server-side token GitHub allows 60 requests/hour, so only ${target} commit diffs are loaded.`
          : null;

      this.#patch({ densify: { active: true, done: this.#details.size, target, limitReason } });

      // Newest-first inside the loaded range: recent history is what people look at first.
      const queue = commits
        .slice(Math.max(0, commits.length - target))
        .map((commit) => commit.sha)
        .reverse();

      let cursor = 0;
      let sinceRecompute = 0;

      const next = (): string | null => {
        while (this.#priority.length > 0) {
          const sha = this.#priority.shift()!;
          if (!this.#details.has(sha)) return sha;
        }
        while (cursor < queue.length) {
          const sha = queue[cursor]!;
          cursor += 1;
          if (!this.#details.has(sha)) return sha;
        }
        return null;
      };

      const worker = async (): Promise<void> => {
        for (;;) {
          if (this.#isStale(generation) || this.#quotaExhausted()) return;
          const sha = next();
          if (!sha) return;
          await this.ensureDetail(sha);
          sinceRecompute += 1;
          if (sinceRecompute >= 15) {
            sinceRecompute = 0;
            this.#scheduleDerived();
          }
        }
      };

      await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
      if (this.#isStale(generation)) return;

      this.#patch({
        densify: {
          active: false,
          done: this.#details.size,
          target,
          limitReason: this.#quotaExhausted()
            ? 'Background loading stopped early to leave GitHub requests available.'
            : limitReason,
        },
      });
      this.#scheduleDerived();
    } finally {
      this.#densifying = false;
    }
  }

  /**
   * Asks GitHub when a handful of signature paths were first committed.
   *
   * One path-scoped request pins a milestone to an exact commit, which is far
   * cheaper than downloading every diff to find the same answer.
   */
  async #runProbes(generation: number, ref: RepoRef, branch: string): Promise<void> {
    // Path probes cost a request each, which the anonymous limit cannot spare.
    // Built-in data has no limit to spare.
    if (!this.#authenticated() && !this.#isBuiltin()) return;
    const commits = this.#state.commits;
    const headSha = commits[commits.length - 1]?.sha;
    if (!headSha) return;
    const headTree = this.#snapshots.get(headSha);
    if (!headTree) return;

    const headPaths = headTree.entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
    const candidates = new Set<string>();
    for (const signature of SIGNATURES) {
      for (const path of signature.probeCandidates?.(headPaths) ?? []) candidates.add(path);
    }

    for (const path of [...candidates].slice(0, 10)) {
      if (this.#isStale(generation) || this.#quotaExhausted()) return;
      try {
        const payload = await this.#api.fetchProbe(ref, branch, path, this.#fetchOptions());
        if (this.#isStale(generation)) return;
        if (payload.firstSha) {
          this.#probes.set(payload.path, payload.firstSha);
          this.#scheduleDerived();
        }
      } catch (error) {
        if (isAbort(error) || this.#isStale(generation)) return;
        // A failed probe only costs precision, so it is not surfaced.
      }
    }
  }

  // --------------------------------------------------------------- derived ---

  #scheduleDerived(): void {
    this.#recomputeHandle?.();
    this.#recomputeHandle = this.#scheduleRecompute(() => {
      this.#recomputeHandle = null;
      this.recomputeDerived();
    });
  }

  /** Recomputes milestones and statistics. Exposed for tests. */
  recomputeDerived(): void {
    const commits = this.#state.commits;
    if (commits.length === 0) {
      this.#patch({ milestones: [], growth: null, activity: null });
      return;
    }

    const snapshots = this.#projector.snapshotIndices.map((index) => ({
      commitIndex: index,
      paths: new Set(this.#projector.project(index).files.keys()),
    }));

    const changesBySha = new Map<string, CommitDetail['files']>();
    for (const [sha, detail] of this.#details) changesBySha.set(sha, detail.files);

    const milestones = detectMilestones({
      commits,
      tags: this.#state.tags,
      changesBySha,
      snapshots,
      probes: this.#probes,
    });

    this.#patch({
      milestones,
      growth: buildGrowthSeries(commits, this.#projector),
      activity: buildActivityMap(commits, this.#details),
    });
  }

  dispose(): void {
    this.#generation += 1;
    this.#abort?.abort();
    this.#recomputeHandle?.();
    this.#listeners.clear();
  }
}

/**
 * Evenly spaced commit indices to read full trees at, always including the
 * oldest and newest commit in the loaded range.
 */
export function planCheckpoints(count: number, budget: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const slots = Math.max(2, Math.min(budget, count));
  if (slots >= count) return Array.from({ length: count }, (_, i) => i);
  const indices = new Set<number>([0, count - 1]);
  for (let i = 1; i < slots - 1; i += 1) {
    indices.add(Math.round((i * (count - 1)) / (slots - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

export { PER_PAGE };
