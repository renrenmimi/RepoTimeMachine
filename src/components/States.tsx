'use client';

import { useEffect, useState } from 'react';
import type { ApiErrorInfo } from '@/lib/client/api';
import { AUTO_PAGES, MAX_PAGES, PER_PAGE } from '@/lib/client/history-controller';
import { BUILTIN_DEMO } from '@/lib/demos';
import { formatNumber, formatRelativeSeconds } from '@/lib/format';
import type { RepoRef } from '@/lib/repo-ref';
import { RepoInput } from './RepoInput';
import { BuiltinGlyph } from './SourceStatus';
import styles from './states.module.css';

/** The real, configured numbers, so the interface cannot drift from the code. */
export const INITIAL_COMMITS = AUTO_PAGES * PER_PAGE;
export const OLDER_STEP = PER_PAGE;
export const MAX_COMMITS = MAX_PAGES * PER_PAGE;

type LandingProps = {
  onOpenDemo: () => void;
  onSelect: (ref: RepoRef) => void;
  onOpenHelp: () => void;
  busy: boolean;
};

/**
 * The home screen.
 *
 * One sentence about what this is, one button that starts it, and one field for
 * bringing your own repository. Everything else — the limits, the reconstruction
 * method, the privacy position — is a click away rather than in the way.
 */
export function Landing({ onOpenDemo, onSelect, onOpenHelp, busy }: LandingProps) {
  return (
    <div className={styles.landing}>
      <div className={styles.landingInner}>
        <h1 className={styles.title}>See how a repository took shape.</h1>
        <p className={styles.lede}>
          Step through commits, inspect file changes, and compare two points in a public repository.
        </p>

        <div className={styles.entries}>
          <section className={styles.demoEntry} aria-labelledby="demo-entry-title">
            <h2 className={styles.entryTitle} id="demo-entry-title">
              Start with the demo
            </h2>
            <button type="button" className={styles.demoAction} onClick={onOpenDemo} disabled={busy}>
              <BuiltinGlyph />
              Explore the demo
            </button>
            <p className={styles.demoCost}>
              {BUILTIN_DEMO.commitCount} synthetic commits &middot; 0 GitHub requests
            </p>
            {/* One accurate sentence. The cost is on the line above it. */}
            <p className={styles.demoDisclosure}>
              Invented data, written for this application — not anybody&rsquo;s repository.
            </p>
          </section>

          <section className={styles.repoEntry} aria-labelledby="repo-entry-title">
            <h2 className={styles.entryTitle} id="repo-entry-title">
              Or open your own
            </h2>
            <RepoInput current={null} busy={busy} onSubmit={onSelect} autoFocus={false} />
            <p className={styles.entryNote}>
              The latest {formatNumber(INITIAL_COMMITS)} commits load first; older history loads on request.{' '}
              <button type="button" className={styles.inlineLink} onClick={onOpenHelp}>
                How it works
              </button>{' '}
              covers the rest.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The detail that would otherwise crowd the field.
 *
 * Reachable from every view, because "how much of the history is this" is a
 * question that occurs to people in the middle of using the thing, not before.
 */
export function HowItWorks() {
  return (
    <div className={styles.help}>
      <section>
        <h3>What it reads</h3>
        <p>
          Public repositories only, through GitHub&rsquo;s official REST API, on the default branch. No login and no
          cloning. Your browser never talks to GitHub directly — every request goes through this application&rsquo;s
          own routes.
        </p>
      </section>

      <section>
        <h3>How much history</h3>
        <p>
          The latest {formatNumber(INITIAL_COMMITS)} commits load automatically. Each{' '}
          <em>Load older commits</em> adds {formatNumber(OLDER_STEP)} more, up to {formatNumber(MAX_COMMITS)} in one
          session. The loaded range is not the whole history, and the earliest commit in it is usually not the
          repository&rsquo;s first commit — every view that reports a count says which of the two it means.
        </p>
      </section>

      <section>
        <h3>How the file tree is rebuilt</h3>
        <p>
          GitHub will not say what a repository looked like at commit N. This reads full file trees at a few commits
          and the diff at each commit, then replays one onto the other. Each position says how it was produced:
          <em> snapshot</em> when a tree was read there, <em>reconstructed</em> when it is a nearby tree plus every
          diff since, and an explicit count of missing diffs when some have not loaded yet. Nothing is filled in by
          guessing.
        </p>
      </section>

      <section>
        <h3>Milestones</h3>
        <p>
          Pattern matches on file paths, commit metadata and tags — nothing is summarised or inferred by a language
          model. Each one states the rule that fired and the evidence for it. Several rules often fire on the same
          commit, so the milestone count is not a count of commits or of project phases.
        </p>
      </section>

      <section>
        <h3>Comparisons</h3>
        <p>
          Two points give the <em>net</em> difference between them, not the sum of every commit in between. Where a
          file changed more than once and the source cannot produce a single net diff for it, the file says so and
          the line counts are labelled as totals across those changes.
        </p>
      </section>

      <section>
        <h3>Rate limits</h3>
        <p>
          Without a server-side token GitHub allows 60 requests an hour per IP address; with one, 5,000. Whichever
          applies to this deployment, the remaining quota is shown as last observed under <em>GitHub usage</em>. There
          is nowhere to paste a personal token, by design.
        </p>
      </section>

      <section>
        <h3>Safety</h3>
        <p>
          Commit messages, file paths and diffs are rendered as text, never as markup, and nothing from a repository
          is ever executed. Diffs and file lists are length-capped, and each cap says so where it applies.
        </p>
      </section>
    </div>
  );
}

type ErrorProps = {
  error: ApiErrorInfo;
  slug: string | null;
  onRetry: () => void;
  onClear: () => void;
  onOpenDemo: () => void;
};

export function ErrorState({ error, slug, onRetry, onClear, onOpenDemo }: ErrorProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.state} role="alert">
      <div className={styles.stateInner}>
        <h2 className={styles.stateHeading}>{headingFor(error.code)}</h2>
        {slug ? <p className={styles.stateSlug}>{slug}</p> : null}
        <p className={styles.stateMessage}>{error.message}</p>

        {error.retryAt ? (
          <p className={styles.stateMessage}>
            The GitHub rate-limit window resets {formatRelativeSeconds(error.retryAt - now)}.
          </p>
        ) : null}

        <div className={styles.stateActions}>
          <button type="button" className={styles.statePrimary} onClick={onRetry}>
            Try again
          </button>
          <button type="button" className={styles.stateSecondary} onClick={onClear}>
            Change repository
          </button>
          <button type="button" className={styles.stateSecondary} onClick={onOpenDemo}>
            Explore the built-in demo
          </button>
        </div>

        {/* The technical detail is available without being the headline. */}
        <details className={styles.stateDetails}>
          <summary>What exactly happened</summary>
          <dl className={styles.stateFacts}>
            <div>
              <dt>Error</dt>
              <dd className={styles.mono}>{error.code}</dd>
            </div>
            {slug ? (
              <div>
                <dt>Repository</dt>
                <dd className={styles.mono}>{slug}</dd>
              </div>
            ) : null}
          </dl>
          {hintsFor(error.code)}
        </details>

        {error.code === 'rate-limited' ? (
          <p className={styles.stateFootnote}>
            The built-in demo is curated synthetic data. It loads without a GitHub account and costs no quota, but it
            is not the repository you asked for.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Extra context, by error kind.
 *
 * `not-found` deliberately does not claim the repository does not exist: GitHub
 * answers 404 for a private repository too, and the two are indistinguishable
 * from outside.
 */
function hintsFor(code: ApiErrorInfo['code']): React.ReactNode {
  if (code === 'not-found') {
    return (
      <ul className={styles.stateHints}>
        <li>GitHub answers the same way for a repository that does not exist and one that is private, so this
          cannot tell them apart.</li>
        <li>Private repositories are not supported in this version.</li>
        <li>Check the spelling of the owner and the repository.</li>
        <li>A renamed repository keeps working on github.com but not through this API path.</li>
      </ul>
    );
  }
  if (code === 'rate-limited') {
    return (
      <ul className={styles.stateHints}>
        <li>Without a token GitHub allows 60 requests per hour, per IP address.</li>
        <li>A self-hosted deployment can set a server-side GITHUB_TOKEN for 5,000 per hour.</li>
        <li>Repositories already loaded stay cached on the server for a while.</li>
      </ul>
    );
  }
  if (code === 'forbidden') {
    return (
      <ul className={styles.stateHints}>
        <li>GitHub accepted the request but refused to answer it, which usually means abuse detection or a
          blocked repository.</li>
        <li>Trying again in a minute is worth one attempt; repeating it is not.</li>
      </ul>
    );
  }
  return null;
}

function headingFor(code: ApiErrorInfo['code']): string {
  switch (code) {
    case 'not-found':
      return 'Repository not found, or private';
    case 'empty-repository':
      return 'This repository has no commits';
    case 'rate-limited':
      return 'GitHub rate limit reached';
    case 'timeout':
      return 'GitHub took too long';
    case 'invalid-input':
      return 'That input is not a repository';
    case 'forbidden':
      return 'GitHub refused the request';
    case 'network':
      return 'Could not reach the server';
    default:
      return 'Something went wrong';
  }
}

export function EmptyRepoState({ slug, onClear }: { slug: string; onClear: () => void }) {
  return (
    <div className={styles.state}>
      <div className={styles.stateInner}>
        <h2 className={styles.stateHeading}>Nothing to play back yet</h2>
        <p className={styles.stateSlug}>{slug}</p>
        <p className={styles.stateMessage}>
          This repository exists but has no commits on its default branch, so there is no history to reconstruct.
        </p>
        <div className={styles.stateActions}>
          <button type="button" className={styles.statePrimary} onClick={onClear}>
            Change repository
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown while the first requests are in flight.
 *
 * It names the steps rather than shimmering: a visitor waiting on a slow
 * repository can see which part is slow.
 */
export function LoadingState({ slug }: { slug: string | null }) {
  return (
    <div className={styles.loading} aria-live="polite">
      <p className={styles.loadingLabel}>Reading history{slug ? ` for ${slug}` : ''}…</p>
      <ol className={styles.loadingSteps}>
        <li>repository metadata and default branch</li>
        <li>a bounded page of commits</li>
        <li>file trees at the ends of the range</li>
        <li>commit diffs, in the background</li>
      </ol>
    </div>
  );
}
