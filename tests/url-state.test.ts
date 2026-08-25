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
    const state = parseAppUrl('?repo=renrenmimi%2FDrillLab&c=6cc6ba6');
    expect(state.repo?.slug).toBe('renrenmimi/DrillLab');
    expect(state.commit).toBe('6cc6ba6');
  });

  it('reads a repository with no commit', () => {
    expect(parseAppUrl('?repo=a%2Fb')).toEqual({ repo: expect.objectContaining({ slug: 'a/b' }), commit: null });
  });

  it('returns the empty state for an empty query', () => {
    expect(parseAppUrl('')).toEqual({ repo: null, commit: null });
    expect(parseAppUrl('?')).toEqual({ repo: null, commit: null });
  });

  it('accepts a leading question mark or a URLSearchParams', () => {
    expect(parseAppUrl('repo=a%2Fb').repo?.slug).toBe('a/b');
    expect(parseAppUrl(new URLSearchParams({ repo: 'a/b' })).repo?.slug).toBe('a/b');
  });

  it('lowercases the commit so shared links are case-insensitive', () => {
    expect(parseAppUrl('?repo=a%2Fb&c=6CC6BA6').commit).toBe('6cc6ba6');
  });

  it('drops an invalid repository entirely', () => {
    expect(parseAppUrl('?repo=https%3A%2F%2Fgitlab.com%2Fa%2Fb')).toEqual({ repo: null, commit: null });
    expect(parseAppUrl('?repo=nonsense')).toEqual({ repo: null, commit: null });
  });

  it('drops a malformed commit but keeps the repository', () => {
    const state = parseAppUrl('?repo=a%2Fb&c=..%2F..%2Fetc');
    expect(state.repo?.slug).toBe('a/b');
    expect(state.commit).toBeNull();
  });

  it('ignores a commit with no repository, since it means nothing on its own', () => {
    expect(parseAppUrl('?c=6cc6ba6')).toEqual({ repo: null, commit: null });
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
    const original = { repo: ref('renrenmimi/PetNote'), commit: 'abcdef1234' };
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
