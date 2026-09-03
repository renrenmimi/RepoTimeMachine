'use client';

import { useEffect, useState } from 'react';
import type { RateLimitSnapshot, RepoMeta } from '@/lib/domain/types';
import { BUILTIN_DEMO } from '@/lib/demos';
import { formatNumber, formatRelativeSeconds } from '@/lib/format';
import styles from './source-status.module.css';

type Props = {
  /** Null until the server has answered. Never inferred from the input. */
  meta: RepoMeta | null;
  loading: boolean;
};

/**
 * Where the data on screen came from.
 *
 * The server sets `dataSource`, and this reads it — nothing here guesses from
 * the slug the visitor typed. Until the answer arrives the line says so, because
 * announcing "live GitHub" before anything has been fetched would be a claim the
 * application has not yet earned.
 */
export function SourceStatus({ meta, loading }: Props) {
  if (!meta) {
    return (
      <p className={styles.line} data-source="pending">
        <span className={styles.label}>{loading ? 'Loading source…' : 'Source not yet known'}</span>
      </p>
    );
  }

  if (meta.dataSource === 'builtin') {
    return (
      <p className={styles.line} data-source="builtin">
        <span className={styles.badge}>
          <BuiltinGlyph />
          {BUILTIN_DEMO.badge}
        </span>
        {/*
         * "GitHub requests", not "API requests": the browser does call this
         * application's own routes for the demo, it just never calls GitHub.
         */}
        <span className={styles.detail}>0 GitHub requests</span>
        <span className={styles.detail}>{BUILTIN_DEMO.disclosure}</span>
      </p>
    );
  }

  return (
    <p className={styles.line} data-source="github">
      <span className={styles.badge} data-tone="info">
        <LiveGlyph />
        Live GitHub
      </span>
      <span className={styles.detail}>
        Read from GitHub&rsquo;s public REST API, default branch <span className={styles.mono}>{meta.defaultBranch}</span>.
      </span>
    </p>
  );
}

/** The mark that distinguishes built-in data from a live repository. */
export function BuiltinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2.2" />
      <path d="M4 6.2 5.6 7.8 8.2 4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LiveGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="6" cy="6" r="4.6" />
      <path d="M6 3.2v3.1l2 1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type UsageProps = {
  snapshot: RateLimitSnapshot | null;
  /** Age of the snapshot in milliseconds, or null when it was just read. */
  ageMs: number | null;
  /** Whether *this deployment* has a server-side token. Not an invitation. */
  tokenConfigured: boolean;
  onOpenDemo: () => void;
};

/**
 * The GitHub quota, as last observed.
 *
 * Quiet while there is room and progressively louder as it runs out, because a
 * red warning about 4,900 remaining requests trains people to ignore the one
 * that matters. The number is explicitly historical: responses served from the
 * data cache replay the headers from when they were first fetched, so calling it
 * live would be a small lie.
 */
export function GitHubUsage({ snapshot, ageMs, tokenConfigured, onOpenDemo }: UsageProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const share = snapshot && snapshot.limit > 0 ? snapshot.remaining / snapshot.limit : null;
  const level = share === null ? 'unknown' : share > 0.25 ? 'ok' : share > 0.08 ? 'low' : 'critical';
  const summary =
    snapshot === null
      ? 'Unknown'
      : `${formatNumber(snapshot.remaining)}/${formatNumber(snapshot.limit)}`;

  return (
    <div className={styles.usage} data-level={level}>
      <button
        type="button"
        className={styles.usageToggle}
        aria-expanded={open}
        aria-label="GitHub request quota"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.usageLabel}>GitHub usage</span>
        {/* Unknown stays the word: rendering it as 0 would read as "exhausted". */}
        <span className={`${styles.usageValue} tabular`}>{summary}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div className={styles.usagePanel}>
          {snapshot === null ? (
            <p className={styles.usageNote}>
              No GitHub response has been observed by this server process yet, so the remaining quota is unknown —
              not zero.
            </p>
          ) : (
            <dl className={styles.usageFacts}>
              <div>
                <dt>Remaining</dt>
                <dd className="tabular">
                  {formatNumber(snapshot.remaining)} of {formatNumber(snapshot.limit)}
                </dd>
              </div>
              <div>
                <dt>Window resets</dt>
                <dd>{formatRelativeSeconds(snapshot.resetAt - Math.floor(now / 1000))}</dd>
              </div>
              <div>
                <dt>Reading taken</dt>
                <dd>{describeAge(ageMs)}</dd>
              </div>
            </dl>
          )}

          {/*
           * Which limit applies is a fact about this deployment, true whether or
           * not a reading has been taken — and it is not an invitation to supply
           * a token of your own, which is why there is nowhere to put one.
           */}
          <p className={styles.usageNote}>
            {tokenConfigured
              ? 'This deployment has a server-side token, so GitHub allows 5,000 requests an hour.'
              : 'This deployment has no server-side token, so GitHub allows 60 requests an hour per IP address.'}
          </p>

          {level === 'low' || level === 'critical' ? (
            <div className={styles.usageAction}>
              <p className={styles.usageNote}>
                The built-in demo needs no quota. It is a different, synthetic repository — not an offline copy of
                this one.
              </p>
              <button type="button" className={styles.usageDemo} onClick={onOpenDemo}>
                Explore the built-in demo
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Never "just now" for a reading whose age is unknown. */
function describeAge(ageMs: number | null): string {
  if (ageMs === null) return 'Age unknown';
  if (ageMs < 45_000) return 'Moments ago';
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none' }}
    >
      <path d="M1.5 3 5 6.5 8.5 3z" />
    </svg>
  );
}
