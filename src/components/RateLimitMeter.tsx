'use client';

import { useEffect, useState } from 'react';
import type { RateLimitSnapshot } from '@/lib/domain/types';
import { formatNumber, formatRelativeSeconds } from '@/lib/format';
import styles from './rate-limit.module.css';

type Props = {
  snapshot: RateLimitSnapshot | null;
  ageMs: number | null;
  tokenConfigured: boolean;
};

/**
 * Shows the GitHub quota as last observed.
 *
 * The number is explicitly historical: responses served from the Next.js data
 * cache replay the headers from when they were first fetched, so presenting it
 * as live would be a small lie.
 */
export function RateLimitMeter({ snapshot, ageMs, tokenConfigured }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!snapshot) {
    return (
      <div
        className={styles.meter}
        aria-label="GitHub request quota"
        title="No GitHub response has been observed yet in this server process."
      >
        <span className={styles.label}>quota</span>
        <span className={styles.value}>—</span>
      </div>
    );
  }

  const share = snapshot.limit > 0 ? snapshot.remaining / snapshot.limit : 0;
  const level = share > 0.5 ? 'ok' : share > 0.15 ? 'low' : 'critical';
  const resetIn = formatRelativeSeconds(snapshot.resetAt - Math.floor(now / 1000));
  const observed = ageMs === null ? 'just now' : ageMs < 45_000 ? 'moments ago' : `${Math.round(ageMs / 60_000)} min ago`;

  return (
    <div
      className={styles.meter}
      data-level={level}
      aria-label="GitHub request quota"
      title={[
        `${formatNumber(snapshot.remaining)} of ${formatNumber(snapshot.limit)} GitHub requests left`,
        `window resets ${resetIn}`,
        `observed ${observed}`,
        tokenConfigured
          ? 'A server-side token is configured (5000 requests/hour).'
          : 'No server-side token: GitHub allows 60 requests/hour per IP.',
      ].join(' · ')}
    >
      <span className={styles.label}>{tokenConfigured ? 'quota' : 'quota · anon'}</span>
      <span className={`${styles.track} tabular`} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
      <span className={`${styles.value} tabular`}>
        {formatNumber(snapshot.remaining)}
        <span className={styles.limit}>/{formatNumber(snapshot.limit)}</span>
      </span>
      <span className="visually-hidden">
        {formatNumber(snapshot.remaining)} of {formatNumber(snapshot.limit)} GitHub API requests remaining, observed{' '}
        {observed}. The window resets {resetIn}.
      </span>
    </div>
  );
}
