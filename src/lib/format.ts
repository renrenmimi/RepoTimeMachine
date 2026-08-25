/** Presentation helpers. All of them assume untrusted input and never build HTML. */

// Commit timestamps are shown in UTC everywhere, so the timeline reads the same
// wherever the visitor is.
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return dateFormatter.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return `${dateTimeFormatter.format(date)} UTC`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}

/** "in 42 minutes" / "3 minutes ago", used for rate-limit resets. */
export function formatRelativeSeconds(deltaSeconds: number): string {
  const abs = Math.abs(deltaSeconds);
  const unit = abs < 90 ? 'second' : abs < 5400 ? 'minute' : 'hour';
  const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : 3600;
  const value = Math.round(deltaSeconds / divisor);
  return new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' }).format(value, unit);
}

/** Elapsed time between two commits, phrased loosely on purpose. */
export function formatGap(fromIso: string, toIso: string): string | null {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const minutes = Math.round((to - from) / 60_000);
  if (minutes < 1) return 'moments later';
  if (minutes < 60) return `${minutes} min later`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h later`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} days later`;
  const months = Math.round(days / 30);
  return `${months} months later`;
}

/** Path split into the directory part and the file name, for two-tone rendering. */
export function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf('/');
  if (index === -1) return { dir: '', name: path };
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** Truncates in the middle so both ends of a long path stay readable. */
export function ellipsisMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
