import 'server-only';

import type { RateLimitSnapshot } from '@/lib/domain/types';

/**
 * The most recent rate-limit headers we have actually seen from GitHub.
 *
 * Responses replayed from the Next.js data cache carry the headers from when
 * they were first fetched, so a snapshot is only trustworthy alongside the time
 * it was observed. The UI shows that age rather than pretending the number is live.
 */
let latest: { snapshot: RateLimitSnapshot; observedAt: number } | null = null;

export function recordRateLimit(snapshot: RateLimitSnapshot | null): void {
  if (!snapshot) return;
  const now = Date.now();
  // A snapshot whose window has already reset tells us nothing useful.
  if (snapshot.resetAt * 1000 < now) return;
  if (latest && latest.observedAt > now - 50 && latest.snapshot.remaining <= snapshot.remaining) return;
  latest = { snapshot, observedAt: now };
}

export function readRateLimit(): { snapshot: RateLimitSnapshot | null; ageMs: number | null } {
  if (!latest) return { snapshot: null, ageMs: null };
  if (latest.snapshot.resetAt * 1000 < Date.now()) {
    latest = null;
    return { snapshot: null, ageMs: null };
  }
  return { snapshot: latest.snapshot, ageMs: Date.now() - latest.observedAt };
}

/** Test seam. */
export function resetRateLimitStore(): void {
  latest = null;
}
