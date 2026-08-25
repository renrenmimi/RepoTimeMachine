import { describe, expect, it } from 'vitest';
import { isValidRefName, isValidSha, parseRepoRef } from '@/lib/repo-ref';

const ok = (input: string) => {
  const result = parseRepoRef(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got ${result.code}: ${result.message}`);
  return result.value;
};

const failure = (input: string) => {
  const result = parseRepoRef(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got ${result.value.slug}`);
  return result;
};

describe('parseRepoRef — accepted forms', () => {
  it('accepts owner/repo shorthand', () => {
    expect(ok('octocat/hello-world')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      slug: 'octocat/hello-world',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(ok('  octocat/hello-world  ').slug).toBe('octocat/hello-world');
  });

  it('accepts a plain repository URL', () => {
    expect(ok('https://github.com/octocat/Spoon-Knife').slug).toBe('octocat/Spoon-Knife');
  });

  it('accepts a URL with extra path segments', () => {
    expect(ok('https://github.com/octocat/Spoon-Knife/tree/main/src/app').slug).toBe('octocat/Spoon-Knife');
  });

  it('accepts a URL with a query string and fragment', () => {
    expect(ok('https://github.com/a/b?tab=readme-ov-file#install').slug).toBe('a/b');
  });

  it('accepts www and http', () => {
    expect(ok('http://www.github.com/a/b').slug).toBe('a/b');
  });

  it('accepts a host-only URL without a scheme', () => {
    expect(ok('github.com/a/b').slug).toBe('a/b');
  });

  it('accepts an scp-style clone URL and strips the .git suffix', () => {
    expect(ok('git@github.com:octocat/example-repo.git').slug).toBe('octocat/example-repo');
  });

  it('accepts an https clone URL and strips the .git suffix', () => {
    expect(ok('https://github.com/octocat/example-repo.git').slug).toBe('octocat/example-repo');
  });

  it('accepts a trailing slash', () => {
    expect(ok('https://github.com/a/b/').slug).toBe('a/b');
  });

  it('accepts dots, dashes and underscores in a repository name', () => {
    expect(ok('owner/my_repo.v2-final').slug).toBe('owner/my_repo.v2-final');
  });

  it('accepts percent-encoded segments', () => {
    expect(ok('https://github.com/owner/my%2Drepo').slug).toBe('owner/my-repo');
  });
});

describe('parseRepoRef — rejected input', () => {
  it('rejects an empty string', () => {
    expect(failure('').code).toBe('empty');
  });

  it('rejects whitespace only', () => {
    expect(failure('   ').code).toBe('empty');
  });

  it.each([
    'https://gitlab.com/a/b',
    'https://bitbucket.org/a/b',
    'https://github.company.internal/a/b',
    'https://raw.githubusercontent.com/a/b/main/x',
    'https://github.com.evil.example/a/b',
    'https://notgithub.com/a/b',
  ])('rejects non-GitHub host %s', (input) => {
    expect(failure(input).code).toBe('unsupported-host');
  });

  it('rejects a GitHub Enterprise host', () => {
    expect(failure('https://github.acme-corp.com/a/b').code).toBe('unsupported-host');
  });

  it.each(['javascript:alert(1)//github.com/a/b', 'file:///etc/passwd', 'data:text/html,<script>'])(
    'rejects dangerous scheme %s',
    (input) => {
      const result = failure(input);
      expect(['unsupported-host', 'malformed']).toContain(result.code);
    },
  );

  it('rejects a URL that is not a repository', () => {
    expect(failure('https://github.com/octocat').code).toBe('not-a-repo-url');
  });

  it.each(['settings', 'marketplace', 'topics', 'explore', 'sponsors'])(
    'rejects the GitHub product route /%s/x',
    (section) => {
      expect(failure(`https://github.com/${section}/x`).code).toBe('not-a-repo-url');
    },
  );

  it.each(['just-a-word', 'a/b/c', 'a//b', '/leading', 'trailing/'])('rejects malformed shorthand %s', (input) => {
    expect(failure(input).ok).toBe(false);
  });

  it('rejects path traversal in the repository name', () => {
    expect(failure('owner/..').ok).toBe(false);
    expect(failure('owner/.').ok).toBe(false);
  });

  it('rejects an owner with characters GitHub does not allow', () => {
    expect(failure('own er/repo').code).toBe('invalid-owner');
    expect(failure('own@er/repo').code).toBe('invalid-owner');
    expect(failure('-owner/repo').code).toBe('invalid-owner');
    expect(failure('owner-/repo').code).toBe('invalid-owner');
    expect(failure('ow--ner/repo').code).toBe('invalid-owner');
  });

  it('rejects an owner longer than GitHub allows', () => {
    expect(failure(`${'a'.repeat(40)}/repo`).code).toBe('invalid-owner');
  });

  it('rejects a repository name with a slash-encoded separator', () => {
    expect(failure('owner/re po').code).toBe('invalid-repo');
  });

  it('rejects absurdly long input before doing any work', () => {
    expect(failure(`a/${'b'.repeat(500)}`).code).toBe('too-long');
  });

  it('rejects a query-string injection attempt', () => {
    expect(failure('owner/repo?per_page=100').code).toBe('invalid-repo');
  });

  it('rejects an attempt to smuggle another path segment', () => {
    expect(failure('owner/repo/../../users').ok).toBe(false);
  });
});

describe('isValidSha', () => {
  it('accepts abbreviated and full shas', () => {
    expect(isValidSha('6cc6ba6')).toBe(true);
    expect(isValidSha('a'.repeat(40))).toBe(true);
  });

  it('rejects short, long, and non-hex values', () => {
    expect(isValidSha('abc')).toBe(false);
    expect(isValidSha('a'.repeat(41))).toBe(false);
    expect(isValidSha('ZZZZZZZ')).toBe(false);
    expect(isValidSha('6cc6ba6/../x')).toBe(false);
    expect(isValidSha('')).toBe(false);
  });
});

describe('isValidRefName', () => {
  it('accepts ordinary branch names', () => {
    expect(isValidRefName('main')).toBe(true);
    expect(isValidRefName('feat/interactive-repo-timeline')).toBe(true);
    expect(isValidRefName('release-1.2.x')).toBe(true);
  });

  it('rejects traversal and option-looking names', () => {
    expect(isValidRefName('../main')).toBe(false);
    expect(isValidRefName('--upload-pack=x')).toBe(false);
    expect(isValidRefName('a//b')).toBe(false);
    expect(isValidRefName('main ')).toBe(false);
    expect(isValidRefName('')).toBe(false);
  });
});
