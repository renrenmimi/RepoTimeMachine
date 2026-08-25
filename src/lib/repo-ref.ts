/**
 * Parsing and validation for the only user-supplied value that ever reaches a
 * network request: the repository reference.
 *
 * Everything downstream builds GitHub API URLs from the `owner` and `repo`
 * fields produced here, so this module is the security boundary. It never
 * returns a host, a base URL or a path fragment taken from user input.
 */

export type RepoRef = {
  owner: string;
  repo: string;
  /** Canonical `owner/repo` form, used as a cache key and in the share URL. */
  slug: string;
};

export type RepoRefErrorCode =
  | 'empty'
  | 'unsupported-host'
  | 'not-a-repo-url'
  | 'malformed'
  | 'invalid-owner'
  | 'invalid-repo'
  | 'too-long';

export type ParseRepoRefResult =
  | { ok: true; value: RepoRef }
  | { ok: false; code: RepoRefErrorCode; message: string };

/** GitHub usernames and organisation names. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** GitHub repository names: letters, digits, `.`, `_`, `-`. */
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

/** Path prefixes that look like `owner/repo` but are GitHub product routes. */
const RESERVED_OWNERS = new Set([
  'about',
  'apps',
  'blog',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'gist',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
]);

const MAX_INPUT_LENGTH = 300;

function fail(code: RepoRefErrorCode, message: string): ParseRepoRefResult {
  return { ok: false, code, message };
}

export function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner);
}

export function isValidRepoName(repo: string): boolean {
  if (repo === '.' || repo === '..') return false;
  return REPO_PATTERN.test(repo);
}

/** Strips a single trailing `.git`, which is legal in clone URLs but not part of the name. */
function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

function build(ownerRaw: string, repoRaw: string): ParseRepoRefResult {
  const owner = ownerRaw.trim();
  const repo = stripGitSuffix(repoRaw.trim());

  if (!owner || !repo) return fail('malformed', 'Use owner/repository or a GitHub repository URL.');
  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    return fail('not-a-repo-url', `"${owner}" is a GitHub site section, not a repository owner.`);
  }
  if (!isValidOwner(owner)) {
    return fail(
      'invalid-owner',
      'Owner must be 1-39 characters: letters, digits, and single hyphens between them.',
    );
  }
  if (!isValidRepoName(repo)) {
    return fail(
      'invalid-repo',
      'Repository name may contain letters, digits, dots, underscores and hyphens only.',
    );
  }

  return { ok: true, value: { owner, repo, slug: `${owner}/${repo}` } };
}

/**
 * Accepts:
 *   owner/repo
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/src
 *   git@github.com:owner/repo.git
 *   github.com/owner/repo
 */
export function parseRepoRef(input: string): ParseRepoRefResult {
  const raw = (input ?? '').trim();
  if (!raw) return fail('empty', 'Enter a repository to load.');
  if (raw.length > MAX_INPUT_LENGTH) return fail('too-long', 'That input is too long to be a repository reference.');

  // scp-style clone URL: git@github.com:owner/repo.git
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/.exec(raw);
  if (scp && !raw.includes('//')) {
    const host = scp[1]!.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
      return fail('unsupported-host', `Only github.com repositories are supported (got "${host}").`);
    }
    const segments = scp[2]!.split('/').filter(Boolean);
    if (segments.length < 2) return fail('not-a-repo-url', 'That URL does not point at a repository.');
    return build(segments[0]!, segments[1]!);
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) || /^(?:www\.)?github\.com\//i.test(raw)) {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return fail('malformed', 'That does not look like a URL or an owner/repository pair.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fail('unsupported-host', 'Only http(s) GitHub URLs are supported.');
    }
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
      return fail(
        'unsupported-host',
        `Only github.com repositories are supported (got "${host}"). Enterprise and mirror hosts are not available.`,
      );
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    if (segments.some((s) => s === null)) return fail('malformed', 'The URL contains invalid escape sequences.');
    const clean = segments as string[];
    if (clean.length < 2) return fail('not-a-repo-url', 'That GitHub URL does not point at a repository.');
    return build(clean[0]!, clean[1]!);
  }

  if (raw.includes('://')) return fail('unsupported-host', 'Only github.com repositories are supported.');

  // The shorthand form is strict: exactly one separator, nothing empty.
  const segments = raw.split('/');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return fail('malformed', 'Use the owner/repository form, for example octocat/hello-world.');
  }
  return build(segments[0], segments[1]);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Git object ids as they appear in the API and in share URLs. */
export function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(sha);
}

/** Branch names used for the default branch. Deliberately narrower than git allows. */
export function isValidRefName(ref: string): boolean {
  if (!ref || ref.length > 255) return false;
  if (ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.includes('..') || ref.includes('//')) return false;
  return /^[A-Za-z0-9._\-/]+$/.test(ref);
}
