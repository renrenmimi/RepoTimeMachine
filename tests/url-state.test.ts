import { describe, expect, it } from 'vitest';
import { buildAppUrl, parseAppUrl, sameUrlState } from '@/lib/url/state';
import { parseRepoRef } from '@/lib/repo-ref';

const ref = (slug: string) => {
  const parsed = parseRepoRef(slug);
  if (!parsed.ok) throw new Error(`bad fixture slug ${slug}`);
  return parsed.value;
};

describe('parseAppUrl', () => {
  it('reads a repository and commit', () => {
    const state = parseAppUrl('?repo=octocat%2Fhello-world&c=6cc6ba6');
    expect(state.repo?.slug).toBe('octocat/hello-world');
    expect(state.commit).toBe('6cc6ba6');
  });

  it('reads a repository with no commit', () => {
    expect(parseAppUrl('?repo=a%2Fb')).toEqual({
      repo: expect.objectContaining({ slug: 'a/b' }),
      commit: null,
      compare: null,
      view: 'replay',
    });
  });

  it('returns the empty state for an empty query', () => {
    expect(parseAppUrl('')).toEqual({ repo: null, commit: null, compare: null, view: 'replay' });
    expect(parseAppUrl('?')).toEqual({ repo: null, commit: null, compare: null, view: 'replay' });
  });

  it('accepts a leading question mark or a URLSearchParams', () => {
    expect(parseAppUrl('repo=a%2Fb').repo?.slug).toBe('a/b');
    expect(parseAppUrl(new URLSearchParams({ repo: 'a/b' })).repo?.slug).toBe('a/b');
  });

  it('lowercases the commit so shared links are case-insensitive', () => {
    expect(parseAppUrl('?repo=a%2Fb&c=6CC6BA6').commit).toBe('6cc6ba6');
  });

  it('drops an invalid repository entirely', () => {
    expect(parseAppUrl('?repo=https%3A%2F%2Fgitlab.com%2Fa%2Fb')).toEqual({
      repo: null,
      commit: null,
      compare: null,
      view: 'replay',
    });
    expect(parseAppUrl('?repo=nonsense')).toEqual({
      repo: null,
      commit: null,
      compare: null,
      view: 'replay',
    });
  });

  it('drops a malformed commit but keeps the repository', () => {
    const state = parseAppUrl('?repo=a%2Fb&c=..%2F..%2Fetc');
    expect(state.repo?.slug).toBe('a/b');
    expect(state.commit).toBeNull();
  });

  it('ignores a commit with no repository, since it means nothing on its own', () => {
    expect(parseAppUrl('?c=6cc6ba6')).toEqual({ repo: null, commit: null, compare: null, view: 'replay' });
  });

  it('accepts a full GitHub URL in the repo parameter', () => {
    expect(parseAppUrl('?repo=https%3A%2F%2Fgithub.com%2Fa%2Fb%2Ftree%2Fmain').repo?.slug).toBe('a/b');
  });

  it('ignores unknown parameters', () => {
    expect(parseAppUrl('?repo=a%2Fb&utm_source=x&c=abcdef1').commit).toBe('abcdef1');
  });
});

describe('buildAppUrl', () => {
  it('returns the home path when nothing is selected', () => {
    expect(buildAppUrl({ repo: null, commit: null })).toBe('/');
    expect(buildAppUrl({ repo: null, commit: 'abcdef1' })).toBe('/');
  });

  it('writes the repository slug', () => {
    expect(buildAppUrl({ repo: ref('a/b'), commit: null })).toBe('/?repo=a%2Fb');
  });

  it('abbreviates the commit so the URL stays short', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: 'a'.repeat(40) });
    expect(url).toBe(`/?repo=a%2Fb&c=${'a'.repeat(10)}`);
  });

  it('omits an invalid commit rather than writing it back out', () => {
    expect(buildAppUrl({ repo: ref('a/b'), commit: 'nope' })).toBe('/?repo=a%2Fb');
  });
});

describe('round trip', () => {
  it('rebuilds the same state a shared URL described', () => {
    const original = { repo: ref('octocat/Spoon-Knife'), commit: 'abcdef1234' };
    const restored = parseAppUrl(buildAppUrl(original).replace('/?', '?'));
    expect(restored.repo?.slug).toBe(original.repo.slug);
    expect(restored.commit).toBe(original.commit);
  });

  it('survives a repository name containing a dot', () => {
    const restored = parseAppUrl(buildAppUrl({ repo: ref('a/next.js'), commit: null }).replace('/?', '?'));
    expect(restored.repo?.slug).toBe('a/next.js');
  });
});

describe('sameUrlState', () => {
  it('compares repository and commit', () => {
    expect(sameUrlState({ repo: ref('a/b'), commit: 'x1' }, { repo: ref('a/b'), commit: 'x1' })).toBe(true);
    expect(sameUrlState({ repo: ref('a/b'), commit: 'x1' }, { repo: ref('a/b'), commit: 'x2' })).toBe(false);
    expect(sameUrlState({ repo: ref('a/b'), commit: null }, { repo: ref('a/c'), commit: null })).toBe(false);
    expect(sameUrlState({ repo: null, commit: null }, { repo: null, commit: null })).toBe(true);
  });
});


describe('comparison in the URL', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);

  it('reads both ends of a comparison', () => {
    const state = parseAppUrl(`?repo=a%2Fb&base=${base}&head=${head}`);
    expect(state.repo?.slug).toBe('a/b');
    expect(state.compare).toEqual({ base, head });
  });

  it('needs both ends: one alone describes nothing', () => {
    expect(parseAppUrl(`?repo=a%2Fb&base=${base}`).compare).toBeNull();
    expect(parseAppUrl(`?repo=a%2Fb&head=${head}`).compare).toBeNull();
  });

  it('ignores a comparison with no repository', () => {
    expect(parseAppUrl(`?base=${base}&head=${head}`).compare).toBeNull();
  });

  it('drops a malformed end rather than half-opening the view', () => {
    expect(parseAppUrl(`?repo=a%2Fb&base=nope&head=${head}`).compare).toBeNull();
    expect(parseAppUrl(`?repo=a%2Fb&base=${base}&head=..%2F..%2Fetc`).compare).toBeNull();
  });

  it('lowercases both ends, so shared links are case-insensitive', () => {
    const state = parseAppUrl('?repo=a%2Fb&base=ABCDEF1&head=1FEDCBA');
    expect(state.compare).toEqual({ base: 'abcdef1', head: '1fedcba' });
  });

  it('writes an abbreviated comparison', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: null, compare: { base, head } });
    expect(url).toBe(`/?repo=a%2Fb&base=${'a'.repeat(10)}&head=${'b'.repeat(10)}`);
  });

  it('replaces the playhead rather than sitting beside it', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: 'c'.repeat(40), compare: { base, head } });
    expect(url).not.toContain('c=');
    expect(url).toContain('base=');
  });

  it('falls back to the playhead when a comparison end is invalid', () => {
    const url = buildAppUrl({
      repo: ref('a/b'),
      commit: 'c'.repeat(40),
      compare: { base, head: 'nope' },
    });
    expect(url).toContain(`c=${'c'.repeat(10)}`);
    expect(url).not.toContain('base=');
  });

  it('round-trips a comparison', () => {
    const original = { repo: ref('octocat/hello-world'), commit: null, compare: { base, head } };
    const restored = parseAppUrl(buildAppUrl(original).replace('/?', '?'));
    expect(restored.repo?.slug).toBe('octocat/hello-world');
    expect(base.startsWith(restored.compare!.base)).toBe(true);
    expect(head.startsWith(restored.compare!.head)).toBe(true);
  });

  it('compares comparisons in sameUrlState', () => {
    const a = { repo: ref('a/b'), commit: null, compare: { base, head } };
    expect(sameUrlState(a, { ...a })).toBe(true);
    expect(sameUrlState(a, { ...a, compare: { base: head, head: base } })).toBe(false);
    expect(sameUrlState(a, { ...a, compare: null })).toBe(false);
  });
});

describe('the view in the URL', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);

  it('defaults to the replay, which is what an old link describes', () => {
    expect(parseAppUrl('?repo=a%2Fb&c=6cc6ba6').view).toBe('replay');
    expect(parseAppUrl('?repo=a%2Fb').view).toBe('replay');
  });

  it('reads and writes the insights view', () => {
    expect(parseAppUrl('?repo=a%2Fb&view=insights').view).toBe('insights');
    const url = buildAppUrl({ repo: ref('a/b'), commit: null, compare: null, view: 'insights' });
    expect(url).toContain('view=insights');
    expect(parseAppUrl(url.replace('/?', '?')).view).toBe('insights');
  });

  it('keeps the playhead in an insights link, so returning to the replay lands there', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: 'c'.repeat(40), compare: null, view: 'insights' });
    expect(url).toContain(`c=${'c'.repeat(10)}`);
    expect(parseAppUrl(url.replace('/?', '?')).commit).toBe('c'.repeat(10));
  });

  it('leaves the replay view out of the URL, since it is the default', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: 'c'.repeat(40), compare: null, view: 'replay' });
    expect(url).not.toContain('view=');
  });

  it('treats a pair of endpoints as the compare view, named or not', () => {
    // Every comparison link handed out before `view` existed looks like this.
    expect(parseAppUrl(`?repo=a%2Fb&base=${base}&head=${head}`).view).toBe('compare');
    expect(parseAppUrl(`?repo=a%2Fb&base=${base}&head=${head}&view=insights`).view).toBe('compare');
  });

  it('writes no view parameter for a comparison, keeping old links byte-identical', () => {
    const url = buildAppUrl({ repo: ref('a/b'), commit: null, compare: { base, head }, view: 'compare' });
    expect(url).not.toContain('view=');
    expect(url).toContain('base=');
  });

  it('falls back safely for an unknown or hostile view value', () => {
    for (const value of ['dashboard', '', 'REPLAY', '../../etc', 'compare']) {
      // `compare` among them: it is not reachable without endpoints, so naming
      // it alone must not open an empty comparison.
      expect(parseAppUrl(`?repo=a%2Fb&view=${encodeURIComponent(value)}`).view).toBe('replay');
    }
  });

  it('ignores a view with no repository', () => {
    expect(parseAppUrl('?view=insights').view).toBe('replay');
  });

  it('distinguishes views in sameUrlState', () => {
    const a = { repo: ref('a/b'), commit: 'c'.repeat(40), compare: null, view: 'replay' as const };
    expect(sameUrlState(a, { ...a })).toBe(true);
    expect(sameUrlState(a, { ...a, view: 'insights' })).toBe(false);
    // An omitted view means the replay, so it is not a different state.
    expect(sameUrlState(a, { repo: a.repo, commit: a.commit, compare: null })).toBe(true);
  });
});
