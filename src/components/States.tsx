'use client';

import { useEffect, useState } from 'react';
import type { ApiErrorInfo } from '@/lib/client/api';
import { BUILTIN_DEMO } from '@/lib/demos';
import { formatRelativeSeconds } from '@/lib/format';
import type { RepoRef } from '@/lib/repo-ref';
import { RepoInput } from './RepoInput';
import styles from './states.module.css';

/**
 * The idle screen. Deliberately not a marketing hero: it explains what the tool
 * does, what "loaded history" means, and gets out of the way.
 */
export function Landing({
  onOpenDemo,
  onSelect,
  busy,
}: {
  onOpenDemo: () => void;
  onSelect: (ref: RepoRef) => void;
  busy: boolean;
}) {
  return (
    <div className={styles.landing}>
      <div className={styles.landingInner}>
        <div className={styles.landingIntro}>
          <p className={styles.eyebrow}>Git history, played back</p>
          <h1 className={styles.title}>
            Watch a repository grow, <span className={styles.titleAccent}>commit by commit</span>.
          </h1>
          <p className={styles.lede}>
            Reconstructs the file tree at each commit, shows what changed, and marks the commits where a project
            visibly turned a corner. Start with the built-in demo, or point it at any public GitHub repository.
          </p>

          <section className={styles.demoCard} aria-labelledby="builtin-demo-title">
            <p className={styles.demoBadge}>
              <BuiltinGlyph />
              {BUILTIN_DEMO.badge}
            </p>
            <h2 className={styles.demoTitle} id="builtin-demo-title">
              {BUILTIN_DEMO.title}
            </h2>
            <p className={styles.demoDescription}>{BUILTIN_DEMO.description}</p>
            <p className={styles.demoDisclosure}>{BUILTIN_DEMO.disclosure}</p>
            <button type="button" className={styles.demoAction} onClick={onOpenDemo} disabled={busy}>
              Play the built-in demo
            </button>
            <p className={styles.demoCost}>
              {BUILTIN_DEMO.commitCount} commits &middot; no GitHub account &middot; 0 GitHub requests
            </p>
          </section>

          <div className={styles.liveBlock}>
            <h2 className={styles.sectionTitle}>Or explore a live repository</h2>
            <div className={styles.landingInput}>
              <RepoInput current={null} busy={busy} onSubmit={onSelect} size="large" />
            </div>
          </div>
        </div>

        <div className={styles.notes}>
          <section>
            <h3>What it reads</h3>
            <p>
              Public repositories only, through GitHub&rsquo;s official REST API. No login, no cloning, and nothing
              from your repository is ever executed.
            </p>
          </section>
          <section>
            <h3>Loaded history</h3>
            <p>
              Up to the latest 300 commits load automatically; older pages load on request. The timeline always says
              exactly how much of the history it holds.
            </p>
          </section>
          <section>
            <h3>Honest reconstruction</h3>
            <p>
              File trees come from real snapshots plus real diffs. When a gap has not loaded yet, the tree says so
              instead of guessing.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The mark that distinguishes built-in data from a live repository. */
export function BuiltinGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2.2" />
      <path d="M4 6.2 5.6 7.8 8.2 4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

  const heading = headingFor(error.code);

  return (
    <div className={styles.state} role="alert">
      <div className={styles.stateInner}>
        <p className={styles.stateCode}>{error.code}</p>
        <h2 className={styles.stateHeading}>{heading}</h2>
        {slug ? <p className={styles.stateSlug}>{slug}</p> : null}
        <p className={styles.stateMessage}>{error.message}</p>

        {error.retryAt ? (
          <p className={styles.stateMessage}>
            The GitHub rate-limit window resets {formatRelativeSeconds(error.retryAt - now)}.
          </p>
        ) : null}

        {error.code === 'not-found' ? (
          <ul className={styles.stateHints}>
            <li>Check the spelling of the owner and repository.</li>
            <li>Private repositories are not supported in this version.</li>
            <li>Renamed repositories keep working on GitHub but not through the API path.</li>
          </ul>
        ) : null}

        {error.code === 'rate-limited' ? (
          <ul className={styles.stateHints}>
            <li>Without a token GitHub allows 60 requests per hour, per IP address.</li>
            <li>A self-hosted deployment can set a server-side GITHUB_TOKEN for 5000 per hour.</li>
            <li>Repositories already loaded stay cached on the server for a while.</li>
          </ul>
        ) : null}

        <div className={styles.stateActions}>
          <button type="button" className={styles.primaryButton} onClick={onRetry}>
            Try again
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onOpenDemo}>
            Open the built-in demo
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onClear}>
            Choose another repository
          </button>
        </div>

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

function headingFor(code: ApiErrorInfo['code']): string {
  switch (code) {
    case 'not-found':
      return 'Repository not found';
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
        <p className={styles.stateCode}>empty</p>
        <h2 className={styles.stateHeading}>Nothing to play back yet</h2>
        <p className={styles.stateSlug}>{slug}</p>
        <p className={styles.stateMessage}>
          This repository exists but has no commits on its default branch, so there is no history to reconstruct.
        </p>
        <div className={styles.stateActions}>
          <button type="button" className={styles.secondaryButton} onClick={onClear}>
            Choose another repository
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown while the first requests are in flight. It reserves the same space the
 * real panels will take, so nothing jumps when the data lands.
 */
export function LoadingState({ slug }: { slug: string | null }) {
  return (
    <div className={styles.loading} aria-live="polite">
      <p className={styles.loadingLabel}>
        Reading history{slug ? ` for ${slug}` : ''}
        <span className={styles.loadingDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </p>
      <ol className={styles.loadingSteps}>
        <li>repository metadata and default branch</li>
        <li>a bounded page of commits</li>
        <li>file trees at the ends of the range</li>
        <li>commit diffs, in the background</li>
      </ol>
    </div>
  );
}
