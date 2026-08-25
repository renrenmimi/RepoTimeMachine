import {
  BUILTIN_DEMO_BADGE,
  BUILTIN_DEMO_DESCRIPTION,
  BUILTIN_DEMO_DISCLOSURE,
  BUILTIN_DEMO_SLUG,
  BUILTIN_DEMO_TITLE,
} from '@/lib/builtin/learning-platform';
import { BUILTIN_DEMO_REF } from '@/lib/builtin/provider';
import type { RepoRef } from '@/lib/repo-ref';

/**
 * The one demo the application ships with.
 *
 * It is a curated synthetic history rather than somebody's repository, so the
 * landing page can show what the tool does without reading a real account and
 * without spending any GitHub quota.
 */
export type BuiltinDemo = {
  ref: RepoRef;
  slug: string;
  title: string;
  badge: string;
  description: string;
  disclosure: string;
  commitCount: number;
};

export const BUILTIN_DEMO: BuiltinDemo = {
  ref: BUILTIN_DEMO_REF,
  slug: BUILTIN_DEMO_SLUG,
  title: BUILTIN_DEMO_TITLE,
  badge: BUILTIN_DEMO_BADGE,
  description: BUILTIN_DEMO_DESCRIPTION,
  disclosure: BUILTIN_DEMO_DISCLOSURE,
  commitCount: 16,
};
