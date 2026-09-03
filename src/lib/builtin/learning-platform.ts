/**
 * The built-in demo history.
 *
 * This is a curated, synthetic history — sixteen invented commits describing how
 * a learning product might plausibly grow. It is **not** a reproduction of any
 * real repository, and none of the file contents, messages, authors or object ids
 * come from one. It exists so the application has something to demonstrate
 * without reading anybody's repository and without spending GitHub quota.
 *
 * What is stored here is **file content**, not diffs.
 *
 * The earlier version of this fixture carried hand-written hunks for a handful of
 * files and hand-written line counts for all of them. Two numbers written next to
 * a hunk written by hand disagree with each other eventually, and most files had
 * no hunk at all — so the demo, which is the first thing anybody sees, answered
 * "no diff available" for almost every file it listed.
 *
 * Now every text file has its exact content at every revision, and the patch, the
 * line counts, the blob ids and the file sizes are all *derived* from it by
 * `src/lib/builtin/provider.ts`. They cannot disagree, because there is only one
 * source for them.
 *
 * Two kinds of file deliberately ship no content: a lockfile and a generated
 * search index. Those declare their size instead, and say so where they are shown.
 */

export const BUILTIN_DEMO_SLUG = 'demo/learning-platform';
export const BUILTIN_DEMO_OWNER = 'demo';
export const BUILTIN_DEMO_REPO = 'learning-platform';
export const BUILTIN_DEMO_TITLE = 'Learning Platform';
export const BUILTIN_DEMO_BADGE = 'Built-in demo';
export const BUILTIN_DEMO_DESCRIPTION =
  'A curated 16-commit history showing a learning product grow from a shell into a guided, accessible experience.';
export const BUILTIN_DEMO_DISCLOSURE =
  'This is a curated, synthetic history — not a live GitHub repository.';
export const BUILTIN_DEMO_BRANCH = 'main';
export const BUILTIN_DEMO_AUTHOR = 'Demo Maintainer';

/**
 * What one commit did to one path.
 *
 * `add`, `mod` and `ren` carry the file's complete text *after* the change, so a
 * diff can be computed against whatever it held before. `opaque` describes a file
 * whose content is not part of the demo.
 */
export type DemoFileOp =
  | { op: 'add'; path: string; text: string }
  | { op: 'mod'; path: string; text: string }
  | { op: 'del'; path: string }
  | { op: 'ren'; path: string; from: string; text?: string }
  /**
   * Present in the tree, content not shipped.
   *
   * `lines` and `bytes` are *declared* rather than derived — there is no content
   * to derive them from — which is stated wherever the numbers appear. A lockfile
   * diff would be several hundred lines of resolved versions and would teach a
   * visitor nothing about how this history grew.
   */
  | { op: 'opaque'; path: string; reason: 'generated' | 'binary'; lines: number; bytes: number }
  | { op: 'opaqueMod'; path: string; lines: number; bytes: number; added: number; removed: number };

export type DemoCommitSpec = {
  sha: string;
  /** ISO 8601, strictly increasing across the list. */
  date: string;
  subject: string;
  body: string;
  files: DemoFileOp[];
};

// ---------------------------------------------------------------- helpers ---

/**
 * File content, written flush-left inside a template literal.
 *
 * Strips one leading newline so the text can start on the line after the
 * backtick, and normalises the trailing newline so every file ends in exactly
 * one. Indentation inside the literal is the file's own.
 */
function f(text: string): string {
  return `${text.replace(/^\n/, '').replace(/\n*$/, '')}\n`;
}

const add = (path: string, text: string): DemoFileOp => ({ op: 'add', path, text: f(text) });
const mod = (path: string, text: string): DemoFileOp => ({ op: 'mod', path, text: f(text) });
const del = (path: string): DemoFileOp => ({ op: 'del', path });
const ren = (from: string, path: string, text?: string): DemoFileOp => ({
  op: 'ren',
  path,
  from,
  ...(text === undefined ? {} : { text: f(text) }),
});
const generated = (path: string, lines: number, bytes: number): DemoFileOp => ({
  op: 'opaque',
  path,
  reason: 'generated',
  lines,
  bytes,
});
const generatedMod = (path: string, lines: number, bytes: number, added: number, removed: number): DemoFileOp => ({
  op: 'opaqueMod',
  path,
  lines,
  bytes,
  added,
  removed,
});

export const DEMO_CREATED_AT = '2025-01-06T08:00:00Z';
export const DEMO_PUSHED_AT = '2025-05-14T10:27:00Z';

export const DEMO_TAGS: readonly { name: string; commitIndex: number }[] = [
  { name: 'v0.1.0', commitIndex: 4 },
  { name: 'v1.0.0', commitIndex: 13 },
];

/**
 * Sixteen commits, oldest first. Exactly sixteen: the count is asserted by the
 * test suite, because the demo's whole point is being a fixed, known history.
 */
export const DEMO_COMMITS: readonly DemoCommitSpec[] = [
  // ------------------------------------------------------------------ 1 ---
  {
    sha: 'efc489e4521d2c40c30fe6fd18678c6219245813',
    date: '2025-01-06T09:12:00Z',
    subject: 'chore: scaffold the application shell',
    body: 'An empty application that builds and serves one page. No product code yet, only the pieces needed to run something.',
    files: [
      add(
        'package.json',
        `
{
  "name": "learning-platform",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`,
      ),
      add(
        'tsconfig.json',
        `
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "preserve",
    "moduleResolution": "bundler",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`,
      ),
      add(
        '.gitignore',
        `
node_modules/
.next/
coverage/
.env.local
`,
      ),
      add(
        'README.md',
        `
# Learning Platform

A place to learn something in small, finishable steps.

Work in progress.
`,
      ),
      add(
        'app/layout.tsx',
        `
export const metadata = {
  title: 'Learning Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      ),
      add(
        'app/page.tsx',
        `
export default function HomePage() {
  return (
    <main>
      <h1>Learning Platform</h1>
    </main>
  );
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 2 ---
  {
    sha: 'f19511761fe6afd7fa6ce5fc6e53245967feb9db',
    date: '2025-01-08T14:40:00Z',
    subject: 'feat: establish design tokens and layout primitives',
    body: 'Every colour, spacing step and radius now has one name. Two layout primitives cover the shapes the product actually needs, so pages stop inventing their own margins.',
    files: [
      add(
        'next.config.ts',
        `
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
`,
      ),
      generated('package-lock.json', 1840, 62_400),
      add(
        'styles/tokens.css',
        `
:root {
  --surface-page: #fbfbf9;
  --surface-card: #ffffff;
  --text: #1c2320;
  --text-dim: #5d6a63;
  --accent: #2f7657;
  --border: #dde3dd;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --radius: 8px;
}
`,
      ),
      add(
        'styles/global.css',
        `
@import './tokens.css';

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--surface-page);
  color: var(--text);
  font-family: system-ui, sans-serif;
  line-height: 1.55;
}

a {
  color: var(--accent);
}
`,
      ),
      add(
        'components/layout/app-shell.tsx',
        `
import { Container } from './container';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-header">
        <Container>
          <strong>Learning Platform</strong>
        </Container>
      </header>
      <main>
        <Container>{children}</Container>
      </main>
    </div>
  );
}
`,
      ),
      add(
        'components/layout/container.tsx',
        `
export function Container({ children }: { children: React.ReactNode }) {
  return <div className="container">{children}</div>;
}
`,
      ),
      add(
        'public/favicon.svg',
        `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#2f7657" />
  <path d="M9 21V11h4l3 6 3-6h4v10" fill="none" stroke="#fff" stroke-width="2" />
</svg>
`,
      ),
      mod(
        'app/layout.tsx',
        `
import { AppShell } from '@/components/layout/app-shell';
import './styles/global.css';

export const metadata = {
  title: 'Learning Platform',
  description: 'Learn something in small, finishable steps.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 3 ---
  {
    sha: 'cb5a18f82d77821319fda7225a34722ea328f630',
    date: '2025-01-13T10:05:00Z',
    subject: 'feat: define lesson and exercise models',
    body: 'A lesson is a title, a body and an ordered list of exercises. An exercise is a prompt plus a way to check an answer. Everything else in the product is built on these two.',
    files: [
      add(
        'lib/models/lesson.ts',
        `
import type { Exercise } from './exercise';

export type Lesson = {
  slug: string;
  title: string;
  summary: string;
  exercises: Exercise[];
};

export function lessonDuration(lesson: Lesson): number {
  return lesson.exercises.reduce((total, item) => total + item.minutes, 0);
}
`,
      ),
      add(
        'lib/models/exercise.ts',
        `
export type Exercise = {
  id: string;
  prompt: string;
  minutes: number;
  answer: string;
};

export function isCorrect(exercise: Exercise, attempt: string): boolean {
  return attempt.trim().toLowerCase() === exercise.answer.trim().toLowerCase();
}
`,
      ),
      add(
        'lib/models/index.ts',
        `
export type { Lesson } from './lesson';
export type { Exercise } from './exercise';
export { lessonDuration } from './lesson';
`,
      ),
      add(
        'tests/models.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { lessonDuration } from '../lib/models/lesson';

const lesson = {
  slug: 'getting-started',
  title: 'Getting started',
  summary: 'A first pass.',
  exercises: [
    { id: 'a', prompt: 'One', minutes: 6, answer: 'yes' },
    { id: 'b', prompt: 'Two', minutes: 12, answer: 'no' },
  ],
};

describe('lessonDuration', () => {
  it('sums the exercise minutes', () => {
    expect(lessonDuration(lesson)).toBe(18);
  });
});
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 4 ---
  {
    sha: 'a909ce5397b9c0af2103c82c216498fb75de9c04',
    date: '2025-01-17T16:22:00Z',
    subject: 'feat: add progress state and local persistence',
    body: 'Progress survives a reload. It is stored per lesson rather than as one blob, so a corrupt entry loses one lesson instead of everything.',
    files: [
      add(
        'lib/progress/types.ts',
        `
export type ProgressState = {
  lessonSlug: string;
  completed: string[];
  updatedAt: number;
};

export function emptyProgress(lessonSlug: string): ProgressState {
  return { lessonSlug, completed: [], updatedAt: 0 };
}
`,
      ),
      add(
        'lib/progress/store.ts',
        `
import type { ProgressState } from './types';

export function markExerciseComplete(state: ProgressState, id: string): ProgressState {
  if (state.completed.includes(id)) return state;
  return {
    ...state,
    completed: [...state.completed, id],
    updatedAt: Date.now(),
  };
}

export function completionRatio(state: ProgressState, total: number): number {
  if (total === 0) return 0;
  return state.completed.length / total;
}
`,
      ),
      add(
        'lib/progress/storage.ts',
        `
import type { ProgressState } from './types';

const prefix = 'learning-platform:progress:';

export function loadProgress(lessonSlug: string): ProgressState | null {
  try {
    const raw = localStorage.getItem(prefix + lessonSlug);
    return raw ? (JSON.parse(raw) as ProgressState) : null;
  } catch {
    // One corrupt entry loses one lesson, not the whole history.
    return null;
  }
}

export function saveProgress(state: ProgressState): void {
  try {
    localStorage.setItem(prefix + state.lessonSlug, JSON.stringify(state));
  } catch {
    // Storage can be unavailable; progress is then simply not remembered.
  }
}
`,
      ),
      add(
        'tests/progress.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { completionRatio, markExerciseComplete } from '../lib/progress/store';
import { emptyProgress } from '../lib/progress/types';

describe('markExerciseComplete', () => {
  it('records an exercise once', () => {
    const first = markExerciseComplete(emptyProgress('a'), 'x');
    const second = markExerciseComplete(first, 'x');
    expect(second.completed).toEqual(['x']);
    expect(second).toBe(first);
  });
});

describe('completionRatio', () => {
  it('is zero for a lesson with no exercises', () => {
    expect(completionRatio(emptyProgress('a'), 0)).toBe(0);
  });
});
`,
      ),
      mod(
        'lib/models/index.ts',
        `
export type { Lesson } from './lesson';
export type { Exercise } from './exercise';
export { lessonDuration } from './lesson';
export { isCorrect } from './exercise';
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 5 ---
  {
    sha: '68e631c1cd7a309874ad8fbc39906129410f23df',
    date: '2025-01-23T11:48:00Z',
    subject: 'feat: publish the first guided lesson',
    body: 'One lesson, end to end: read a short explanation, answer three exercises, see progress recorded. Enough to tell whether the shape of the thing works.',
    files: [
      add(
        'content/lessons/getting-started.mdx',
        `
---
slug: getting-started
title: Getting started
summary: Read a little, try a little, and see what stuck.
---

Learning something new goes better in small pieces. This lesson is one piece.

## What you will do

Read three short sections. After each one, answer a single question. Nothing is
timed, and nothing is graded.

## Why it is short

A lesson you can finish is worth more than a lesson you mean to finish.
`,
      ),
      add(
        'components/lesson/lesson-view.tsx',
        `
import type { Lesson } from '@/lib/models';
import { ExerciseList } from './exercise-list';

export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <article aria-labelledby="lesson-title">
      <h1 id="lesson-title">{lesson.title}</h1>
      <p>{lesson.summary}</p>
      <ExerciseList exercises={lesson.exercises} />
    </article>
  );
}
`,
      ),
      add(
        'components/lesson/exercise-list.tsx',
        `
import type { Exercise } from '@/lib/models';

export function ExerciseList({ exercises }: { exercises: Exercise[] }) {
  return (
    <ol className="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <p>{exercise.prompt}</p>
          <input aria-label={exercise.prompt} name={exercise.id} />
        </li>
      ))}
    </ol>
  );
}
`,
      ),
      add(
        'app/lessons/[slug]/page.tsx',
        `
import { LessonView } from '@/components/lesson/lesson-view';
import { getLesson } from '@/lib/content/load-lessons';

export default async function LessonPage({ params }: { params: { slug: string } }) {
  const lesson = await getLesson(params.slug);
  if (!lesson) return <p>That lesson does not exist.</p>;
  return <LessonView lesson={lesson} />;
}
`,
      ),
      add(
        'tests/lesson-view.test.tsx',
        `
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LessonView } from '../components/lesson/lesson-view';

const lesson = {
  slug: 'getting-started',
  title: 'Getting started',
  summary: 'A first pass.',
  exercises: [{ id: 'a', prompt: 'What changed?', minutes: 4, answer: 'nothing' }],
};

describe('LessonView', () => {
  it('names itself with the lesson title', () => {
    render(<LessonView lesson={lesson} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Getting started');
  });
});
`,
      ),
      mod(
        'app/page.tsx',
        `
import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Learning Platform</h1>
      <p>Start with one lesson and see how far it gets you.</p>
      <Link href="/lessons/getting-started">Getting started</Link>
    </main>
  );
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 6 ---
  {
    sha: '62618def3b583489d0125be04e5e77fbcc030556',
    date: '2025-02-03T09:30:00Z',
    subject: 'feat: expand the learning library',
    body: 'Four more lessons, and a grid to find them in. Writing several at once exposed how much of the lesson view assumed a single hard-coded page.',
    files: [
      add(
        'LICENSE',
        `
MIT License

Copyright (c) 2025 Learning Platform

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`,
      ),
      add(
        'content/lessons/reading-errors.mdx',
        `
---
slug: reading-errors
title: Reading errors
summary: An error message is a description, not a verdict.
---

Most error messages say three things: what was attempted, what went wrong, and
where. Reading them in that order turns a wall of text into a sentence.

## Start at the top

The first line is usually the actual failure. The rest is how it got there.
`,
      ),
      add(
        'content/lessons/shaping-data.mdx',
        `
---
slug: shaping-data
title: Shaping data
summary: Pick the shape that makes the wrong state impossible.
---

If two fields can contradict each other, something eventually will. A shape that
cannot hold the contradiction saves the check.

## Worked example

A request is either loading, or it failed, or it has data. Never two at once.
`,
      ),
      add(
        'content/lessons/writing-tests.mdx',
        `
---
slug: writing-tests
title: Writing tests
summary: Name the behaviour, not the function.
---

A test named after the function tells you what broke. A test named after the
behaviour tells you what somebody lost.

## A rule of thumb

If the test name would survive a rewrite of the code, it is a good name.
`,
      ),
      add(
        'content/lessons/asking-questions.mdx',
        `
---
slug: asking-questions
title: Asking questions
summary: Say what you expected. That is the whole trick.
---

"It does not work" cannot be answered. "I expected X, I got Y, here is what I
tried" almost answers itself.

## What to include

The input, the expectation, the result, and the one thing you already ruled out.
`,
      ),
      add(
        'lib/content/load-lessons.ts',
        `
import type { Lesson } from '@/lib/models';

const modules = import.meta.glob('../../content/lessons/*.mdx', { eager: true });

export async function listLessons(): Promise<Lesson[]> {
  return Object.values(modules)
    .map((module) => (module as { frontmatter: Lesson }).frontmatter)
    .sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

export async function getLesson(slug: string): Promise<Lesson | null> {
  const lessons = await listLessons();
  return lessons.find((lesson) => lesson.slug === slug) ?? null;
}
`,
      ),
      add(
        'components/library/lesson-card.tsx',
        `
import Link from 'next/link';
import type { Lesson } from '@/lib/models';

export function LessonCard({ lesson }: { lesson: Lesson }) {
  return (
    <Link className="lesson-card" href={\`/lessons/\${lesson.slug}\`}>
      <h3>{lesson.title}</h3>
      <p>{lesson.summary}</p>
    </Link>
  );
}
`,
      ),
      add(
        'components/library/library-grid.tsx',
        `
import type { Lesson } from '@/lib/models';
import { LessonCard } from './lesson-card';

export function LibraryGrid({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) {
    return <p>No lessons yet.</p>;
  }
  return (
    <div className="library-grid">
      {lessons.map((lesson) => (
        <LessonCard key={lesson.slug} lesson={lesson} />
      ))}
    </div>
  );
}
`,
      ),
      add(
        'app/library/page.tsx',
        `
import { LibraryGrid } from '@/components/library/library-grid';
import { listLessons } from '@/lib/content/load-lessons';

export default async function LibraryPage() {
  const lessons = await listLessons();
  return (
    <>
      <h1>Library</h1>
      <LibraryGrid lessons={lessons} />
    </>
  );
}
`,
      ),
      add(
        'tests/library.test.tsx',
        `
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LibraryGrid } from '../components/library/library-grid';

describe('LibraryGrid', () => {
  it('says so when there is nothing to show', () => {
    render(<LibraryGrid lessons={[]} />);
    expect(screen.getByText('No lessons yet.')).toBeInTheDocument();
  });
});
`,
      ),
      mod(
        'components/lesson/lesson-view.tsx',
        `
import type { Lesson } from '@/lib/models';
import { lessonDuration } from '@/lib/models';
import { ExerciseList } from './exercise-list';

export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <article aria-labelledby="lesson-title">
      <header>
        <h1 id="lesson-title">{lesson.title}</h1>
        <p className="lesson-summary">{lesson.summary}</p>
        <p className="lesson-meta">About {lessonDuration(lesson)} minutes</p>
      </header>
      <ExerciseList exercises={lesson.exercises} />
    </article>
  );
}
`,
      ),
      mod(
        'styles/tokens.css',
        `
:root {
  --surface-page: #fbfbf9;
  --surface-card: #ffffff;
  --text: #1c2320;
  --text-dim: #5d6a63;
  --accent: #2f7657;
  --border: #dde3dd;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --radius: 8px;
  --grid-gap: 1rem;
  --card-min: 16rem;
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 7 ---
  {
    sha: 'f0620b3d28d3e9e64bb8456b7f7212992ea3474a',
    date: '2025-02-11T15:15:00Z',
    subject: 'feat: generate navigation and search indexes',
    body: 'Navigation and search read one generated index instead of walking the content directory at request time. The index is built ahead of time and treated as generated output.',
    files: [
      add(
        'lib/index/build-index.ts',
        `
import { listLessons } from '@/lib/content/load-lessons';

export type SearchEntry = {
  slug: string;
  title: string;
  haystack: string;
};

export type SearchIndex = {
  builtAt: string;
  entries: SearchEntry[];
};

export async function buildIndex(): Promise<SearchIndex> {
  const lessons = await listLessons();
  return {
    builtAt: new Date().toISOString(),
    entries: lessons.map((lesson) => ({
      slug: lesson.slug,
      title: lesson.title,
      haystack: \`\${lesson.title} \${lesson.summary}\`.toLowerCase(),
    })),
  };
}
`,
      ),
      add(
        'lib/index/search.ts',
        `
import type { SearchEntry, SearchIndex } from './build-index';

export function search(index: SearchIndex, query: string): SearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return index.entries.filter((entry) => entry.haystack.includes(needle)).slice(0, 20);
}
`,
      ),
      add(
        'components/search/search-dialog.tsx',
        `
'use client';

import { useState } from 'react';
import type { SearchIndex } from '@/lib/index/build-index';
import { search } from '@/lib/index/search';

export function SearchDialog({ index }: { index: SearchIndex }) {
  const [query, setQuery] = useState('');
  const hits = search(index, query);

  return (
    <div role="dialog" aria-label="Search lessons">
      <input
        aria-label="Search lessons"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query && hits.length === 0 ? <p>Nothing matches “{query}”.</p> : null}
      <ul>
        {hits.map((hit) => (
          <li key={hit.slug}>{hit.title}</li>
        ))}
      </ul>
    </div>
  );
}
`,
      ),
      generated('public/generated/search-index.json', 620, 24_800),
      add(
        'scripts/build-index.sh',
        `
#!/usr/bin/env bash
set -euo pipefail

node ./scripts/build-index.mjs
echo "index written"
`,
      ),
      add(
        'tests/search.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { search } from '../lib/index/search';

const index = {
  builtAt: '2025-02-11T00:00:00Z',
  entries: [
    { slug: 'reading-errors', title: 'Reading errors', haystack: 'reading errors' },
    { slug: 'shaping-data', title: 'Shaping data', haystack: 'shaping data' },
  ],
};

describe('search', () => {
  it('returns nothing for an empty query', () => {
    expect(search(index, '   ')).toEqual([]);
  });

  it('matches on the haystack, not only the title', () => {
    expect(search(index, 'data')).toHaveLength(1);
  });
});
`,
      ),
      mod(
        'components/layout/app-shell.tsx',
        `
import Link from 'next/link';
import { Container } from './container';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-header">
        <Container>
          <strong>Learning Platform</strong>
          <nav aria-label="Main">
            <Link href="/library">Library</Link>
            <Link href="/search">Search</Link>
          </nav>
        </Container>
      </header>
      <main>
        <Container>{children}</Container>
      </main>
    </div>
  );
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 8 ---
  {
    sha: '31a8fae638b019a6fa546d527fdd4d0723668bc0',
    date: '2025-02-20T13:02:00Z',
    subject: 'feat: add guided practice sessions',
    body: 'A practice session picks exercises the learner has not finished and asks them in a fixed order, so a session is repeatable rather than random.',
    files: [
      add(
        'lib/practice/session.ts',
        `
import type { Exercise } from '@/lib/models';
import type { ProgressState } from '@/lib/progress/types';

export type Session = {
  id: string;
  items: Exercise[];
};

export function buildSession(pool: Exercise[], progress: ProgressState, size: number): Session {
  const unfinished = pool.filter((item) => !progress.completed.includes(item.id));
  const items = unfinished.slice(0, size);
  return {
    // Derived from the contents, so the same pool always gives the same session.
    id: items.map((item) => item.id).join('-') || 'empty',
    items,
  };
}
`,
      ),
      add(
        'lib/practice/scoring.ts',
        `
import type { Exercise } from '@/lib/models';
import { isCorrect } from '@/lib/models';

export type Attempt = { exerciseId: string; answer: string };

export function scoreSession(items: Exercise[], attempts: Attempt[]): number {
  let correct = 0;
  for (const item of items) {
    const attempt = attempts.find((entry) => entry.exerciseId === item.id);
    if (attempt && isCorrect(item, attempt.answer)) correct += 1;
  }
  return correct;
}
`,
      ),
      add(
        'components/practice/practice-runner.tsx',
        `
'use client';

import { useState } from 'react';
import type { Session } from '@/lib/practice/session';
import { scoreSession, type Attempt } from '@/lib/practice/scoring';
import { PracticeSummary } from './practice-summary';

export function PracticeRunner({ session }: { session: Session }) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [done, setDone] = useState(false);

  if (done) {
    return <PracticeSummary total={session.items.length} correct={scoreSession(session.items, attempts)} />;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setDone(true);
      }}
    >
      {session.items.map((item) => (
        <p key={item.id}>
          <label htmlFor={item.id}>{item.prompt}</label>
          <input
            id={item.id}
            onChange={(event) =>
              setAttempts((current) => [
                ...current.filter((entry) => entry.exerciseId !== item.id),
                { exerciseId: item.id, answer: event.target.value },
              ])
            }
          />
        </p>
      ))}
      <button type="submit">Finish</button>
    </form>
  );
}
`,
      ),
      add(
        'components/practice/practice-summary.tsx',
        `
export function PracticeSummary({ total, correct }: { total: number; correct: number }) {
  return (
    <section aria-label="Practice summary">
      <h2>
        {correct} of {total}
      </h2>
      <p>{correct === total ? 'All of them.' : 'Worth another pass.'}</p>
    </section>
  );
}
`,
      ),
      add(
        'app/practice/page.tsx',
        `
import { PracticeRunner } from '@/components/practice/practice-runner';
import { buildSession } from '@/lib/practice/session';
import { listLessons } from '@/lib/content/load-lessons';
import { emptyProgress } from '@/lib/progress/types';

export default async function PracticePage() {
  const lessons = await listLessons();
  const pool = lessons.flatMap((lesson) => lesson.exercises);
  const session = buildSession(pool, emptyProgress('practice'), 5);
  return (
    <>
      <h1>Practice</h1>
      <PracticeRunner session={session} />
    </>
  );
}
`,
      ),
      add(
        'tests/practice.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { buildSession } from '../lib/practice/session';
import { scoreSession } from '../lib/practice/scoring';
import { emptyProgress } from '../lib/progress/types';

const pool = [
  { id: 'a', prompt: 'One', minutes: 2, answer: 'yes' },
  { id: 'b', prompt: 'Two', minutes: 2, answer: 'no' },
];

describe('buildSession', () => {
  it('is repeatable for the same pool and progress', () => {
    const first = buildSession(pool, emptyProgress('p'), 2);
    const second = buildSession(pool, emptyProgress('p'), 2);
    expect(first.id).toBe(second.id);
  });

  it('skips what is already finished', () => {
    const progress = { ...emptyProgress('p'), completed: ['a'] };
    expect(buildSession(pool, progress, 2).items.map((item) => item.id)).toEqual(['b']);
  });
});

describe('scoreSession', () => {
  it('ignores answers to exercises not in the session', () => {
    expect(scoreSession([pool[0]!], [{ exerciseId: 'b', answer: 'no' }])).toBe(0);
  });
});
`,
      ),
      mod(
        'lib/progress/store.ts',
        `
import type { ProgressState } from './types';

export function markExerciseComplete(state: ProgressState, id: string): ProgressState {
  if (state.completed.includes(id)) return state;
  return {
    ...state,
    completed: [...state.completed, id],
    updatedAt: Date.now(),
  };
}

export function markSessionComplete(state: ProgressState, ids: string[]): ProgressState {
  return ids.reduce(markExerciseComplete, state);
}

export function completionRatio(state: ProgressState, total: number): number {
  if (total === 0) return 0;
  return state.completed.length / total;
}
`,
      ),
    ],
  },

  // ------------------------------------------------------------------ 9 ---
  {
    sha: 'fd2d50b1c3ab3b8bb62dfa3fa93ab1e9d5ba6e1e',
    date: '2025-03-04T10:41:00Z',
    subject: 'feat: introduce the coding workspace',
    body: 'Exercises can now be answered with code instead of a text field. The runner is deliberately dull: it evaluates a submission against fixed cases in a worker and reports which ones passed.',
    files: [
      // The workspace pulls in an editor, so the lockfile moves with it.
      generatedMod('package-lock.json', 1980, 67_200, 168, 28),
      add(
        'lib/workspace/cases.ts',
        `
export type TestCase = {
  name: string;
  input: unknown[];
  expected: unknown;
};

export const cases: Record<string, TestCase[]> = {
  'sum-list': [
    { name: 'empty', input: [[]], expected: 0 },
    { name: 'one item', input: [[4]], expected: 4 },
    { name: 'several', input: [[1, 2, 3]], expected: 6 },
  ],
};

export function casesFor(exerciseId: string): TestCase[] {
  return cases[exerciseId] ?? [];
}
`,
      ),
      add(
        'lib/workspace/runner.ts',
        `
import { casesFor, type TestCase } from './cases';

export type CaseResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export type RunOutcome = {
  results: CaseResult[];
  passed: number;
  total: number;
};

/**
 * Runs one submission against its fixed cases.
 *
 * The evaluation itself happens in a worker; this only decides what to ask for
 * and how to describe the answer, which is the part worth testing.
 */
export function summarise(exerciseId: string, outcomes: CaseResult[]): RunOutcome {
  const total = casesFor(exerciseId).length;
  return {
    results: outcomes,
    passed: outcomes.filter((result) => result.passed).length,
    total,
  };
}

export function describeCase(testCase: TestCase, actual: unknown): CaseResult {
  const passed = JSON.stringify(actual) === JSON.stringify(testCase.expected);
  return {
    name: testCase.name,
    passed,
    detail: passed ? 'as expected' : \`expected \${JSON.stringify(testCase.expected)}, got \${JSON.stringify(actual)}\`,
  };
}
`,
      ),
      add(
        'lib/workspace/worker.ts',
        `
/// <reference lib="webworker" />

import { casesFor } from './cases';
import { describeCase } from './runner';

/**
 * Evaluates a submission away from the page.
 *
 * A worker is the boundary: a submission that loops forever stalls the worker
 * and not the interface, and the page can terminate it.
 */
self.onmessage = (event: MessageEvent<{ exerciseId: string; source: string }>) => {
  const { exerciseId, source } = event.data;
  const results = [];

  try {
    const candidate = new Function(\`"use strict"; return (\${source});\`)() as (...args: unknown[]) => unknown;
    for (const testCase of casesFor(exerciseId)) {
      results.push(describeCase(testCase, candidate(...testCase.input)));
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'unknown failure' });
    return;
  }

  self.postMessage({ results });
};
`,
      ),
      add(
        'components/workspace/editor-pane.tsx',
        `
'use client';

export function EditorPane({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="editor-pane">
      <label htmlFor="submission">Your answer</label>
      <textarea
        id="submission"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
`,
      ),
      add(
        'components/workspace/result-pane.tsx',
        `
import type { RunOutcome } from '@/lib/workspace/runner';

export function ResultPane({ outcome }: { outcome: RunOutcome | null }) {
  if (!outcome) {
    return <p className="result-pane-idle">Run your answer to see the cases.</p>;
  }

  return (
    <div className="result-pane">
      <p>
        {outcome.passed} of {outcome.total} cases passed
      </p>
      <ul>
        {outcome.results.map((result) => (
          <li key={result.name} data-passed={result.passed}>
            <strong>{result.name}</strong> — {result.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
`,
      ),
      add(
        'components/workspace/workspace-layout.tsx',
        `
'use client';

import { useState } from 'react';
import type { RunOutcome } from '@/lib/workspace/runner';
import { EditorPane } from './editor-pane';
import { ResultPane } from './result-pane';

export function WorkspaceLayout({ exerciseId }: { exerciseId: string }) {
  const [source, setSource] = useState('(list) => 0');
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  return (
    <div className="workspace">
      <EditorPane value={source} onChange={setSource} />
      <button type="button" onClick={() => setOutcome(null)}>
        Run {exerciseId}
      </button>
      <ResultPane outcome={outcome} />
    </div>
  );
}
`,
      ),
      add(
        'app/workspace/page.tsx',
        `
import { WorkspaceLayout } from '@/components/workspace/workspace-layout';

export default function WorkspacePage() {
  return (
    <>
      <h1>Workspace</h1>
      <WorkspaceLayout exerciseId="sum-list" />
    </>
  );
}
`,
      ),
      add(
        'styles/workspace.css',
        `
.workspace {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.editor-pane textarea {
  width: 100%;
  min-height: 16rem;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 20px;
}

.result-pane li[data-passed='false'] {
  color: #b34c4c;
}
`,
      ),
      add(
        'tests/workspace-cases.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { casesFor } from '../lib/workspace/cases';

describe('casesFor', () => {
  it('returns nothing for an exercise with no cases', () => {
    expect(casesFor('not-a-real-exercise')).toEqual([]);
  });

  it('starts with the empty case, so a wrong answer fails early', () => {
    expect(casesFor('sum-list')[0]?.name).toBe('empty');
  });
});
`,
      ),
      add(
        'tests/workspace-runner.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { describeCase, summarise } from '../lib/workspace/runner';

describe('describeCase', () => {
  it('says what it expected when a case fails', () => {
    const result = describeCase({ name: 'one item', input: [[4]], expected: 4 }, 0);
    expect(result.passed).toBe(false);
    expect(result.detail).toBe('expected 4, got 0');
  });
});

describe('summarise', () => {
  it('counts the total from the cases, not from the results', () => {
    const outcome = summarise('sum-list', [{ name: 'empty', passed: true, detail: 'as expected' }]);
    expect(outcome.passed).toBe(1);
    expect(outcome.total).toBe(3);
  });
});
`,
      ),
      mod(
        'lib/models/exercise.ts',
        `
export type ExerciseKind = 'text' | 'code';

export type Exercise = {
  id: string;
  prompt: string;
  minutes: number;
  kind: ExerciseKind;
  /** Expected answer, for text exercises only. */
  answer?: string;
};

export function isCorrect(exercise: Exercise, attempt: string): boolean {
  if (exercise.kind !== 'text' || exercise.answer === undefined) return false;
  return attempt.trim().toLowerCase() === exercise.answer.trim().toLowerCase();
}
`,
      ),
      mod(
        'components/lesson/exercise-list.tsx',
        `
import Link from 'next/link';
import type { Exercise } from '@/lib/models';

export function ExerciseList({ exercises }: { exercises: Exercise[] }) {
  return (
    <ol className="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <p>{exercise.prompt}</p>
          {exercise.kind === 'code' ? (
            <Link href={\`/workspace?exercise=\${exercise.id}\`}>Open the workspace</Link>
          ) : (
            <input aria-label={exercise.prompt} name={exercise.id} />
          )}
        </li>
      ))}
    </ol>
  );
}
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 10 ---
  {
    sha: '47915e96ba5e1d83231f231a800aa842482612e8',
    date: '2025-03-14T17:26:00Z',
    subject: 'feat: add assessment and review modes',
    body: 'An assessment is a practice session that keeps its answers, so a review can show what was wrong and why. Continuous integration starts running the test suite on every push.',
    files: [
      add(
        '.github/workflows/ci.yml',
        `
name: CI

on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
`,
      ),
      add(
        'lib/assessment/score.ts',
        `
import type { Exercise } from '@/lib/models';
import { isCorrect } from '@/lib/models';

export type Answer = { exerciseId: string; given: string };

export type Scored = {
  exerciseId: string;
  correct: boolean;
  given: string;
  expected: string | null;
};

export function scoreAssessment(items: Exercise[], answers: Answer[]): Scored[] {
  return items.map((item) => {
    const answer = answers.find((entry) => entry.exerciseId === item.id);
    const given = answer?.given ?? '';
    return {
      exerciseId: item.id,
      correct: answer ? isCorrect(item, given) : false,
      given,
      expected: item.answer ?? null,
    };
  });
}
`,
      ),
      add(
        'lib/assessment/review.ts',
        `
import type { Scored } from './score';

export type ReviewEntry = Scored & { note: string };

export function buildReview(scored: Scored[]): ReviewEntry[] {
  return scored
    .filter((entry) => !entry.correct)
    .map((entry) => ({
      ...entry,
      note:
        entry.given === ''
          ? 'Left blank.'
          : entry.expected === null
            ? 'Answered in the workspace; see the case results.'
            : \`Expected “\${entry.expected}”.\`,
    }));
}
`,
      ),
      add(
        'components/assessment/review-list.tsx',
        `
import type { ReviewEntry } from '@/lib/assessment/review';

export function ReviewList({ entries }: { entries: ReviewEntry[] }) {
  if (entries.length === 0) {
    return <p>Nothing to review — every answer was right.</p>;
  }

  return (
    <ul className="review-list">
      {entries.map((entry) => (
        <li key={entry.exerciseId}>
          <strong>{entry.exerciseId}</strong>
          <p>{entry.note}</p>
        </li>
      ))}
    </ul>
  );
}
`,
      ),
      add(
        'components/assessment/assessment-runner.tsx',
        `
'use client';

import { useState } from 'react';
import type { Exercise } from '@/lib/models';
import { buildReview } from '@/lib/assessment/review';
import { scoreAssessment, type Answer } from '@/lib/assessment/score';
import { ReviewList } from './review-list';

export function AssessmentRunner({ items }: { items: Exercise[] }) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [reviewing, setReviewing] = useState(false);

  if (reviewing) {
    return <ReviewList entries={buildReview(scoreAssessment(items, answers))} />;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setReviewing(true);
      }}
    >
      {items.map((item) => (
        <p key={item.id}>
          <label htmlFor={item.id}>{item.prompt}</label>
          <input
            id={item.id}
            onChange={(event) =>
              setAnswers((current) => [
                ...current.filter((entry) => entry.exerciseId !== item.id),
                { exerciseId: item.id, given: event.target.value },
              ])
            }
          />
        </p>
      ))}
      <button type="submit">Review</button>
    </form>
  );
}
`,
      ),
      add(
        'app/assessment/page.tsx',
        `
import { AssessmentRunner } from '@/components/assessment/assessment-runner';
import { listLessons } from '@/lib/content/load-lessons';

export default async function AssessmentPage() {
  const lessons = await listLessons();
  return (
    <>
      <h1>Assessment</h1>
      <AssessmentRunner items={lessons.flatMap((lesson) => lesson.exercises)} />
    </>
  );
}
`,
      ),
      add(
        'tests/assessment.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { buildReview } from '../lib/assessment/review';
import { scoreAssessment } from '../lib/assessment/score';

const items = [
  { id: 'a', prompt: 'One', minutes: 2, kind: 'text' as const, answer: 'yes' },
  { id: 'b', prompt: 'Two', minutes: 2, kind: 'code' as const },
];

describe('scoreAssessment', () => {
  it('counts an unanswered exercise as wrong rather than skipping it', () => {
    expect(scoreAssessment(items, [])).toHaveLength(2);
  });
});

describe('buildReview', () => {
  it('says a blank answer was blank', () => {
    const review = buildReview(scoreAssessment(items, []));
    expect(review[0]?.note).toBe('Left blank.');
  });

  it('does not claim an expected answer for a code exercise', () => {
    const review = buildReview(scoreAssessment(items, [{ exerciseId: 'b', given: '() => 1' }]));
    expect(review.find((entry) => entry.exerciseId === 'b')?.note).toMatch(/case results/);
  });
});
`,
      ),
      mod(
        'lib/practice/scoring.ts',
        `
import type { Exercise } from '@/lib/models';
import { scoreAssessment, type Answer } from '@/lib/assessment/score';

export type Attempt = Answer;

/**
 * One scoring path for practice and assessment.
 *
 * Practice used to have its own comparison, which drifted the moment code
 * exercises arrived and only assessment learned about them.
 */
export function scoreSession(items: Exercise[], attempts: Attempt[]): number {
  return scoreAssessment(items, attempts).filter((entry) => entry.correct).length;
}
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 11 ---
  {
    sha: '78c2808ce57786285cf655e6a2633962b54718fc',
    date: '2025-03-25T12:08:00Z',
    subject: 'feat: introduce guided learning paths',
    body: 'A path is an ordered list of lessons with a reason for the order. Three of them cover the ways people actually arrive: new to this, reading somebody else\'s code, or stuck.',
    files: [
      add(
        'content/paths/first-steps.yaml',
        `
slug: first-steps
title: First steps
summary: For somebody who has not written much yet.
lessons:
  - getting-started
  - reading-errors
  - writing-tests
`,
      ),
      add(
        'content/paths/reading-code.yaml',
        `
slug: reading-code
title: Reading code
summary: For somebody handed a repository they did not write.
lessons:
  - reading-errors
  - shaping-data
  - asking-questions
`,
      ),
      add(
        'content/paths/building-confidence.yaml',
        `
slug: building-confidence
title: Building confidence
summary: For somebody who can read it but hesitates to change it.
lessons:
  - writing-tests
  - shaping-data
  - getting-started
`,
      ),
      add(
        'lib/paths/types.ts',
        `
export type LearningPath = {
  slug: string;
  title: string;
  summary: string;
  /** Lesson slugs, in the order they are meant to be taken. */
  lessons: string[];
};
`,
      ),
      add(
        'lib/paths/resolve.ts',
        `
import type { Lesson } from '@/lib/models';
import type { LearningPath } from './types';

export type ResolvedPath = LearningPath & {
  /** Lessons in path order. A slug with no lesson is dropped, and counted. */
  resolved: Lesson[];
  missing: string[];
};

export function resolvePath(path: LearningPath, lessons: Lesson[]): ResolvedPath {
  const bySlug = new Map(lessons.map((lesson) => [lesson.slug, lesson]));
  const resolved: Lesson[] = [];
  const missing: string[] = [];

  for (const slug of path.lessons) {
    const lesson = bySlug.get(slug);
    if (lesson) resolved.push(lesson);
    else missing.push(slug);
  }

  return { ...path, resolved, missing };
}
`,
      ),
      add(
        'components/paths/path-card.tsx',
        `
import Link from 'next/link';
import type { ResolvedPath } from '@/lib/paths/resolve';

export function PathCard({ path }: { path: ResolvedPath }) {
  return (
    <Link className="path-card" href={\`/paths/\${path.slug}\`}>
      <h3>{path.title}</h3>
      <p>{path.summary}</p>
      <p className="path-card-meta">{path.resolved.length} lessons</p>
    </Link>
  );
}
`,
      ),
      add(
        'components/paths/path-outline.tsx',
        `
import type { ResolvedPath } from '@/lib/paths/resolve';

export function PathOutline({ path }: { path: ResolvedPath }) {
  return (
    <ol className="path-outline">
      {path.resolved.map((lesson, index) => (
        <li key={lesson.slug}>
          <span className="path-outline-step">{index + 1}</span>
          {lesson.title}
        </li>
      ))}
      {path.missing.length > 0 ? (
        <li className="path-outline-missing">
          {path.missing.length} lesson(s) in this path have not been written yet.
        </li>
      ) : null}
    </ol>
  );
}
`,
      ),
      add(
        'app/paths/page.tsx',
        `
import { PathCard } from '@/components/paths/path-card';
import { listLessons } from '@/lib/content/load-lessons';
import { resolvePath } from '@/lib/paths/resolve';
import { listPaths } from '@/lib/paths/load-paths';

export default async function PathsPage() {
  const [paths, lessons] = await Promise.all([listPaths(), listLessons()]);
  return (
    <>
      <h1>Paths</h1>
      <div className="path-grid">
        {paths.map((path) => (
          <PathCard key={path.slug} path={resolvePath(path, lessons)} />
        ))}
      </div>
    </>
  );
}
`,
      ),
      add(
        'tests/paths.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { resolvePath } from '../lib/paths/resolve';

const lessons = [
  { slug: 'a', title: 'A', summary: '', exercises: [] },
  { slug: 'b', title: 'B', summary: '', exercises: [] },
];

describe('resolvePath', () => {
  it('keeps the path order, not the lesson order', () => {
    const path = { slug: 'p', title: 'P', summary: '', lessons: ['b', 'a'] };
    expect(resolvePath(path, lessons).resolved.map((lesson) => lesson.slug)).toEqual(['b', 'a']);
  });

  it('reports a slug with no lesson instead of dropping it silently', () => {
    const path = { slug: 'p', title: 'P', summary: '', lessons: ['a', 'nope'] };
    expect(resolvePath(path, lessons).missing).toEqual(['nope']);
  });
});
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 12 ---
  {
    sha: 'a97b30455ee5375b9e0c2e0e1b0f44f4c4617588',
    date: '2025-04-02T09:55:00Z',
    subject: 'feat: make progress and continuation plan-aware',
    body: 'Progress knows which path it is part of, so "carry on" has an answer. The next step is the first unfinished lesson in the chosen path rather than whatever was opened last.',
    files: [
      add(
        'lib/progress/plan.ts',
        `
import type { ResolvedPath } from '@/lib/paths/resolve';
import type { ProgressState } from './types';

export type Plan = {
  pathSlug: string;
  /** Lesson slugs still to do, in path order. */
  remaining: string[];
  finished: number;
  total: number;
};

export function buildPlan(path: ResolvedPath, progress: ProgressState[]): Plan {
  const done = new Set(
    progress.filter((state) => state.completed.length > 0).map((state) => state.lessonSlug),
  );
  const remaining = path.resolved.map((lesson) => lesson.slug).filter((slug) => !done.has(slug));

  return {
    pathSlug: path.slug,
    remaining,
    finished: path.resolved.length - remaining.length,
    total: path.resolved.length,
  };
}
`,
      ),
      add(
        'lib/paths/next-step.ts',
        `
import type { Plan } from '@/lib/progress/plan';

export type NextStep =
  | { kind: 'lesson'; slug: string; position: number; of: number }
  | { kind: 'finished'; pathSlug: string };

export function nextStep(plan: Plan): NextStep {
  const slug = plan.remaining[0];
  if (!slug) return { kind: 'finished', pathSlug: plan.pathSlug };
  return { kind: 'lesson', slug, position: plan.finished + 1, of: plan.total };
}
`,
      ),
      add(
        'tests/plan.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../lib/progress/plan';
import { nextStep } from '../lib/paths/next-step';

const path = {
  slug: 'p',
  title: 'P',
  summary: '',
  lessons: ['a', 'b'],
  resolved: [
    { slug: 'a', title: 'A', summary: '', exercises: [] },
    { slug: 'b', title: 'B', summary: '', exercises: [] },
  ],
  missing: [],
};

describe('buildPlan', () => {
  it('treats a lesson with no completed exercises as unfinished', () => {
    const plan = buildPlan(path, [{ lessonSlug: 'a', completed: [], updatedAt: 0 }]);
    expect(plan.remaining).toEqual(['a', 'b']);
  });
});

describe('nextStep', () => {
  it('points at the first unfinished lesson in path order', () => {
    const plan = buildPlan(path, [{ lessonSlug: 'a', completed: ['x'], updatedAt: 1 }]);
    expect(nextStep(plan)).toEqual({ kind: 'lesson', slug: 'b', position: 2, of: 2 });
  });

  it('says the path is finished rather than returning nothing', () => {
    const plan = buildPlan(path, [
      { lessonSlug: 'a', completed: ['x'], updatedAt: 1 },
      { lessonSlug: 'b', completed: ['y'], updatedAt: 2 },
    ]);
    expect(nextStep(plan)).toEqual({ kind: 'finished', pathSlug: 'p' });
  });
});
`,
      ),
      mod(
        'lib/progress/types.ts',
        `
export type ProgressState = {
  lessonSlug: string;
  /** The path this lesson was opened from, when it was opened from one. */
  pathSlug: string | null;
  completed: string[];
  updatedAt: number;
};

export function emptyProgress(lessonSlug: string, pathSlug: string | null = null): ProgressState {
  return { lessonSlug, pathSlug, completed: [], updatedAt: 0 };
}
`,
      ),
      mod(
        'lib/progress/store.ts',
        `
import type { ProgressState } from './types';

export function markExerciseComplete(state: ProgressState, id: string): ProgressState {
  if (state.completed.includes(id)) return state;
  return {
    ...state,
    completed: [...state.completed, id],
    updatedAt: Date.now(),
  };
}

export function markSessionComplete(state: ProgressState, ids: string[]): ProgressState {
  return ids.reduce(markExerciseComplete, state);
}

export function attachToPath(state: ProgressState, pathSlug: string): ProgressState {
  if (state.pathSlug === pathSlug) return state;
  return { ...state, pathSlug, updatedAt: Date.now() };
}

export function completionRatio(state: ProgressState, total: number): number {
  if (total === 0) return 0;
  return state.completed.length / total;
}
`,
      ),
      mod(
        'lib/paths/resolve.ts',
        `
import type { Lesson } from '@/lib/models';
import type { LearningPath } from './types';

export type ResolvedPath = LearningPath & {
  /** Lessons in path order. A slug with no lesson is dropped, and counted. */
  resolved: Lesson[];
  missing: string[];
};

export function resolvePath(path: LearningPath, lessons: Lesson[]): ResolvedPath {
  const bySlug = new Map(lessons.map((lesson) => [lesson.slug, lesson]));
  const resolved: Lesson[] = [];
  const missing: string[] = [];

  for (const slug of path.lessons) {
    const lesson = bySlug.get(slug);
    if (lesson) resolved.push(lesson);
    else missing.push(slug);
  }

  return { ...path, resolved, missing };
}

export function findPath(paths: LearningPath[], slug: string): LearningPath | null {
  return paths.find((path) => path.slug === slug) ?? null;
}
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 13 ---
  {
    sha: '69e42370ba56d099c90b917746e446679d14c7ce',
    date: '2025-04-11T14:33:00Z',
    subject: 'refactor: unify navigation and next actions',
    body: 'Four places decided what to offer next, and they disagreed. One function decides now, and the rail, the drawer and the two pages read it. The practice summary and the path outline were doing the same job under two names.',
    files: [
      add(
        'lib/navigation/resolve-next.ts',
        `
import type { NextStep } from '@/lib/paths/next-step';

export type Action = {
  label: string;
  href: string;
};

/**
 * The one place that decides what to offer next.
 *
 * The rail, the drawer, the practice page and the paths page each had their own
 * version of this, and they disagreed about what to do at the end of a path.
 */
export function resolveNextAction(step: NextStep): Action {
  if (step.kind === 'finished') {
    return { label: 'Choose another path', href: '/paths' };
  }
  return {
    label: \`Continue: lesson \${step.position} of \${step.of}\`,
    href: \`/lessons/\${step.slug}\`,
  };
}
`,
      ),
      add(
        'components/navigation/next-action.tsx',
        `
import Link from 'next/link';
import type { NextStep } from '@/lib/paths/next-step';
import { resolveNextAction } from '@/lib/navigation/resolve-next';

export function NextAction({ step }: { step: NextStep }) {
  const action = resolveNextAction(step);
  return (
    <Link className="next-action" href={action.href}>
      {action.label}
    </Link>
  );
}
`,
      ),
      add(
        'components/navigation/nav-rail.tsx',
        `
import Link from 'next/link';
import type { NextStep } from '@/lib/paths/next-step';
import { NextAction } from './next-action';

const destinations = [
  { href: '/library', label: 'Library' },
  { href: '/paths', label: 'Paths' },
  { href: '/practice', label: 'Practice' },
  { href: '/workspace', label: 'Workspace' },
];

export function NavRail({ step }: { step: NextStep }) {
  return (
    <nav className="nav-rail" aria-label="Main">
      <ul>
        {destinations.map((destination) => (
          <li key={destination.href}>
            <Link href={destination.href}>{destination.label}</Link>
          </li>
        ))}
      </ul>
      <NextAction step={step} />
    </nav>
  );
}
`,
      ),
      add(
        'components/navigation/mobile-drawer.tsx',
        `
'use client';

import { useEffect, useRef } from 'react';
import type { NextStep } from '@/lib/paths/next-step';
import { NavRail } from './nav-rail';

export function MobileDrawer({
  open,
  step,
  onClose,
}: {
  open: boolean;
  step: NextStep;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    surface.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div
        ref={surface}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <NavRail step={step} />
      </div>
    </div>
  );
}
`,
      ),
      ren(
        'components/library/lesson-card.tsx',
        'components/library/library-card.tsx',
        `
import Link from 'next/link';
import type { Lesson } from '@/lib/models';

export function LibraryCard({ lesson }: { lesson: Lesson }) {
  return (
    <Link className="library-card" href={\`/lessons/\${lesson.slug}\`}>
      <h3>{lesson.title}</h3>
      <p>{lesson.summary}</p>
    </Link>
  );
}
`,
      ),
      del('components/practice/practice-summary.tsx'),
      del('components/paths/path-outline.tsx'),
      mod(
        'components/library/library-grid.tsx',
        `
import type { Lesson } from '@/lib/models';
import { LibraryCard } from './library-card';

export function LibraryGrid({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) {
    return <p>No lessons yet.</p>;
  }
  return (
    <div className="library-grid">
      {lessons.map((lesson) => (
        <LibraryCard key={lesson.slug} lesson={lesson} />
      ))}
    </div>
  );
}
`,
      ),
      mod(
        'components/practice/practice-runner.tsx',
        `
'use client';

import { useState } from 'react';
import type { Session } from '@/lib/practice/session';
import { scoreSession, type Attempt } from '@/lib/practice/scoring';
import { NextAction } from '@/components/navigation/next-action';
import type { NextStep } from '@/lib/paths/next-step';

export function PracticeRunner({ session, step }: { session: Session; step: NextStep }) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [done, setDone] = useState(false);

  if (done) {
    const correct = scoreSession(session.items, attempts);
    return (
      <section aria-label="Practice summary">
        <h2>
          {correct} of {session.items.length}
        </h2>
        <NextAction step={step} />
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setDone(true);
      }}
    >
      {session.items.map((item) => (
        <p key={item.id}>
          <label htmlFor={item.id}>{item.prompt}</label>
          <input
            id={item.id}
            onChange={(event) =>
              setAttempts((current) => [
                ...current.filter((entry) => entry.exerciseId !== item.id),
                { exerciseId: item.id, given: event.target.value },
              ])
            }
          />
        </p>
      ))}
      <button type="submit">Finish</button>
    </form>
  );
}
`,
      ),
      mod(
        'components/layout/app-shell.tsx',
        `
'use client';

import { useState } from 'react';
import type { NextStep } from '@/lib/paths/next-step';
import { MobileDrawer } from '@/components/navigation/mobile-drawer';
import { NavRail } from '@/components/navigation/nav-rail';
import { Container } from './container';

export function AppShell({ children, step }: { children: React.ReactNode; step: NextStep }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="shell">
      <header className="shell-header">
        <Container>
          <strong>Learning Platform</strong>
          <button type="button" className="drawer-toggle" onClick={() => setDrawerOpen(true)}>
            Menu
          </button>
        </Container>
      </header>
      <div className="shell-body">
        <NavRail step={step} />
        <main>
          <Container>{children}</Container>
        </main>
      </div>
      <MobileDrawer open={drawerOpen} step={step} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
`,
      ),
      mod(
        'app/practice/page.tsx',
        `
import { PracticeRunner } from '@/components/practice/practice-runner';
import { buildSession } from '@/lib/practice/session';
import { listLessons } from '@/lib/content/load-lessons';
import { emptyProgress } from '@/lib/progress/types';
import { nextStep } from '@/lib/paths/next-step';

export default async function PracticePage() {
  const lessons = await listLessons();
  const pool = lessons.flatMap((lesson) => lesson.exercises);
  const session = buildSession(pool, emptyProgress('practice'), 5);
  const step = nextStep({ pathSlug: 'first-steps', remaining: [], finished: 0, total: 0 });
  return (
    <>
      <h1>Practice</h1>
      <PracticeRunner session={session} step={step} />
    </>
  );
}
`,
      ),
      mod(
        'app/paths/page.tsx',
        `
import { PathCard } from '@/components/paths/path-card';
import { listLessons } from '@/lib/content/load-lessons';
import { resolvePath } from '@/lib/paths/resolve';
import { listPaths } from '@/lib/paths/load-paths';

export default async function PathsPage() {
  const [paths, lessons] = await Promise.all([listPaths(), listLessons()]);
  const resolved = paths.map((path) => resolvePath(path, lessons));
  return (
    <>
      <h1>Paths</h1>
      <p>Each path is an order somebody found useful, not a syllabus.</p>
      <div className="path-grid">
        {resolved.map((path) => (
          <PathCard key={path.slug} path={path} />
        ))}
      </div>
    </>
  );
}
`,
      ),
      mod(
        'tests/paths.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { resolvePath } from '../lib/paths/resolve';
import { resolveNextAction } from '../lib/navigation/resolve-next';

const lessons = [
  { slug: 'a', title: 'A', summary: '', exercises: [] },
  { slug: 'b', title: 'B', summary: '', exercises: [] },
];

describe('resolvePath', () => {
  it('keeps the path order, not the lesson order', () => {
    const path = { slug: 'p', title: 'P', summary: '', lessons: ['b', 'a'] };
    expect(resolvePath(path, lessons).resolved.map((lesson) => lesson.slug)).toEqual(['b', 'a']);
  });

  it('reports a slug with no lesson instead of dropping it silently', () => {
    const path = { slug: 'p', title: 'P', summary: '', lessons: ['a', 'nope'] };
    expect(resolvePath(path, lessons).missing).toEqual(['nope']);
  });
});

describe('resolveNextAction', () => {
  it('offers another path at the end of one, rather than nothing', () => {
    expect(resolveNextAction({ kind: 'finished', pathSlug: 'p' }).href).toBe('/paths');
  });
});
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 14 ---
  {
    sha: '99e788035dfa1cb18a1c15f8fb1b7e88b9b83a3f',
    date: '2025-04-22T11:19:00Z',
    subject: 'feat: add dashboard progress views',
    body: 'One page that answers "where am I". A ring per path and a strip of the last fortnight, both computed from stored progress rather than from a separate counter.',
    files: [
      add(
        'vercel.json',
        `
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [{ "key": "X-Content-Type-Options", "value": "nosniff" }]
    }
  ]
}
`,
      ),
      add(
        'lib/stats/summary.ts',
        `
import type { Plan } from '@/lib/progress/plan';
import type { ProgressState } from '@/lib/progress/types';

export type Summary = {
  /** 0..1, or null when the path holds no lessons. */
  ratio: number | null;
  finished: number;
  total: number;
};

export function summarisePlan(plan: Plan): Summary {
  return {
    // Null rather than 0: an empty path is unmeasured, not unstarted.
    ratio: plan.total === 0 ? null : plan.finished / plan.total,
    finished: plan.finished,
    total: plan.total,
  };
}

/** Days, oldest first, each true when something was completed that day. */
export function activeDays(progress: ProgressState[], days: number, now: number): boolean[] {
  const dayMs = 86_400_000;
  const today = Math.floor(now / dayMs);
  const active = new Set(
    progress.filter((state) => state.updatedAt > 0).map((state) => Math.floor(state.updatedAt / dayMs)),
  );
  return Array.from({ length: days }, (_, index) => active.has(today - (days - 1 - index)));
}
`,
      ),
      add(
        'components/dashboard/progress-ring.tsx',
        `
import type { Summary } from '@/lib/stats/summary';

export function ProgressRing({ summary, label }: { summary: Summary; label: string }) {
  if (summary.ratio === null) {
    return (
      <figure className="progress-ring" aria-label={\`\${label}: no lessons yet\`}>
        <figcaption>{label}</figcaption>
        <p>No lessons in this path yet.</p>
      </figure>
    );
  }

  const percent = Math.round(summary.ratio * 100);
  return (
    <figure
      className="progress-ring"
      aria-label={\`\${label}: \${summary.finished} of \${summary.total} lessons\`}
    >
      <svg viewBox="0 0 42 42" role="presentation">
        <circle cx="21" cy="21" r="18" className="ring-track" />
        <circle
          cx="21"
          cy="21"
          r="18"
          className="ring-fill"
          strokeDasharray={\`\${percent} 100\`}
        />
      </svg>
      <figcaption>
        {label} — {summary.finished}/{summary.total}
      </figcaption>
    </figure>
  );
}
`,
      ),
      add(
        'components/dashboard/streak-strip.tsx',
        `
export function StreakStrip({ days }: { days: boolean[] }) {
  const active = days.filter(Boolean).length;
  return (
    <div
      className="streak-strip"
      role="img"
      aria-label={\`\${active} active days in the last \${days.length}\`}
    >
      {days.map((isActive, index) => (
        <span key={index} className="streak-day" data-active={isActive} />
      ))}
    </div>
  );
}
`,
      ),
      add(
        'components/dashboard/dashboard-grid.tsx',
        `
import type { Plan } from '@/lib/progress/plan';
import type { ProgressState } from '@/lib/progress/types';
import { activeDays, summarisePlan } from '@/lib/stats/summary';
import { ProgressRing } from './progress-ring';
import { StreakStrip } from './streak-strip';

export function DashboardGrid({
  plans,
  progress,
  now,
}: {
  plans: Plan[];
  progress: ProgressState[];
  now: number;
}) {
  return (
    <div className="dashboard-grid">
      {plans.map((plan) => (
        <ProgressRing key={plan.pathSlug} summary={summarisePlan(plan)} label={plan.pathSlug} />
      ))}
      <StreakStrip days={activeDays(progress, 14, now)} />
    </div>
  );
}
`,
      ),
      add(
        'app/dashboard/page.tsx',
        `
import { DashboardGrid } from '@/components/dashboard/dashboard-grid';

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <p>Everything here is computed from progress stored in this browser.</p>
      <DashboardGrid plans={[]} progress={[]} now={Date.now()} />
    </>
  );
}
`,
      ),
      add(
        'tests/summary.test.ts',
        `
import { describe, expect, it } from 'vitest';
import { activeDays, summarisePlan } from '../lib/stats/summary';

describe('summarisePlan', () => {
  it('reports an empty path as unmeasured rather than as zero progress', () => {
    expect(summarisePlan({ pathSlug: 'p', remaining: [], finished: 0, total: 0 }).ratio).toBeNull();
  });
});

describe('activeDays', () => {
  const day = 86_400_000;

  it('returns one entry per day, oldest first', () => {
    expect(activeDays([], 14, 10 * day)).toHaveLength(14);
  });

  it('ignores progress that was never updated', () => {
    const days = activeDays([{ lessonSlug: 'a', pathSlug: null, completed: [], updatedAt: 0 }], 3, 3 * day);
    expect(days).toEqual([false, false, false]);
  });
});
`,
      ),
      mod(
        'components/navigation/nav-rail.tsx',
        `
import Link from 'next/link';
import type { NextStep } from '@/lib/paths/next-step';
import { NextAction } from './next-action';

const destinations = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/library', label: 'Library' },
  { href: '/paths', label: 'Paths' },
  { href: '/practice', label: 'Practice' },
  { href: '/workspace', label: 'Workspace' },
];

export function NavRail({ step }: { step: NextStep }) {
  return (
    <nav className="nav-rail" aria-label="Main">
      <ul>
        {destinations.map((destination) => (
          <li key={destination.href}>
            <Link href={destination.href}>{destination.label}</Link>
          </li>
        ))}
      </ul>
      <NextAction step={step} />
    </nav>
  );
}
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 15 ---
  {
    sha: '1fc9a6428cf3d9d9c04b3fbcd1e02b7bb4d59f5c',
    date: '2025-05-06T16:04:00Z',
    subject: 'fix: align responsive layouts and accessibility',
    body: 'The workspace, the dashboard and the rail each broke at a different width. One set of breakpoints now, and every interactive element states its own name.',
    files: [
      add(
        'styles/responsive.css',
        `
/* One set of breakpoints, used by every layout in the product. */
@media (max-width: 899px) {
  .shell-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .nav-rail {
    display: none;
  }

  .drawer-toggle {
    display: inline-flex;
  }
}

@media (min-width: 900px) {
  .drawer-toggle {
    display: none;
  }
}
`,
      ),
      add(
        'tests/accessibility.test.tsx',
        `
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreakStrip } from '../components/dashboard/streak-strip';
import { ProgressRing } from '../components/dashboard/progress-ring';

describe('StreakStrip', () => {
  it('describes itself in words, not only in colour', () => {
    render(<StreakStrip days={[true, false, true]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('2 active days in the last 3');
  });
});

describe('ProgressRing', () => {
  it('names the path and the counts', () => {
    render(
      <ProgressRing summary={{ ratio: 0.5, finished: 1, total: 2 }} label="first-steps" />,
    );
    expect(screen.getByLabelText('first-steps: 1 of 2 lessons')).toBeInTheDocument();
  });
});
`,
      ),
      mod(
        'styles/global.css',
        `
@import './tokens.css';
@import './responsive.css';

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--surface-page);
  color: var(--text);
  font-family: system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.55;
}

a {
  color: var(--accent);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.shell-body {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr);
  gap: var(--space-6);
}
`,
      ),
      mod(
        'styles/tokens.css',
        `
:root {
  --surface-page: #fbfbf9;
  --surface-card: #ffffff;
  --text: #1c2320;
  --text-dim: #5d6a63;
  --accent: #2f7657;
  --border: #dde3dd;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --radius: 8px;
  --grid-gap: 1rem;
  --card-min: 16rem;
  --control-height: 2.5rem;
  --touch-target: 2.75rem;
}
`,
      ),
      mod(
        'styles/workspace.css',
        `
.workspace {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

/* Stacked below the shared breakpoint: two panes at 390px is one unusable pane. */
@media (max-width: 899px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}

.editor-pane textarea {
  width: 100%;
  min-height: 16rem;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 20px;
}

.result-pane li[data-passed='false'] {
  color: #b34c4c;
}
`,
      ),
      mod(
        'components/workspace/editor-pane.tsx',
        `
'use client';

export function EditorPane({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="editor-pane">
      <label htmlFor="submission">Your answer</label>
      <textarea
        id="submission"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-describedby="submission-hint"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="submission-hint">A function expression, for example (list) =&gt; 0.</p>
    </div>
  );
}
`,
      ),
      mod(
        'components/dashboard/dashboard-grid.tsx',
        `
import type { Plan } from '@/lib/progress/plan';
import type { ProgressState } from '@/lib/progress/types';
import { activeDays, summarisePlan } from '@/lib/stats/summary';
import { ProgressRing } from './progress-ring';
import { StreakStrip } from './streak-strip';

export function DashboardGrid({
  plans,
  progress,
  now,
}: {
  plans: Plan[];
  progress: ProgressState[];
  now: number;
}) {
  if (plans.length === 0) {
    return <p>Start a path and this fills in.</p>;
  }

  return (
    <div className="dashboard-grid">
      {plans.map((plan) => (
        <ProgressRing key={plan.pathSlug} summary={summarisePlan(plan)} label={plan.pathSlug} />
      ))}
      <StreakStrip days={activeDays(progress, 14, now)} />
    </div>
  );
}
`,
      ),
      mod(
        'components/lesson/lesson-view.tsx',
        `
import type { Lesson } from '@/lib/models';
import { lessonDuration } from '@/lib/models';
import { ExerciseList } from './exercise-list';

export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <article aria-labelledby="lesson-title">
      <header>
        <h1 id="lesson-title">{lesson.title}</h1>
        <p className="lesson-summary">{lesson.summary}</p>
        <p className="lesson-meta">
          <span>About {lessonDuration(lesson)} minutes</span>
          <span aria-hidden="true"> · </span>
          <span>{lesson.exercises.length} exercises</span>
        </p>
      </header>
      <ExerciseList exercises={lesson.exercises} />
    </article>
  );
}
`,
      ),
    ],
  },

  // ----------------------------------------------------------------- 16 ---
  {
    sha: '49b7926f0c4b8b6c9b7e2d5b3ba1eb2cf9a5b7ce',
    date: '2025-05-14T10:27:00Z',
    subject: 'fix: lock background scrolling behind the mobile drawer',
    body: 'Opening the drawer on a phone scrolled the page underneath it. The lock restores the scroll position on close, because setting overflow alone loses it.',
    files: [
      add(
        'lib/dom/scroll-lock.ts',
        `
/**
 * Stops the page behind an overlay from scrolling.
 *
 * \`overflow: hidden\` alone lets the document jump to the top and stay there once
 * the overlay closes, so the position is captured and restored.
 */
export function lockScroll(): () => void {
  const { body } = document;
  const scrollY = window.scrollY;
  const previous = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
  };

  body.style.overflow = 'hidden';
  body.style.position = 'fixed';
  body.style.top = \`-\${scrollY}px\`;
  body.style.width = '100%';

  return () => {
    body.style.overflow = previous.overflow;
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.width = previous.width;
    window.scrollTo(0, scrollY);
  };
}
`,
      ),
      add(
        'tests/scroll-lock.test.ts',
        `
import { describe, expect, it, vi } from 'vitest';
import { lockScroll } from '../lib/dom/scroll-lock';

describe('lockScroll', () => {
  it('restores the styles it found, not a guess at the defaults', () => {
    document.body.style.overflow = 'scroll';
    const release = lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('puts the scroll position back', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true });
    lockScroll()();
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });
});
`,
      ),
      mod(
        'components/navigation/mobile-drawer.tsx',
        `
'use client';

import { useEffect, useRef } from 'react';
import type { NextStep } from '@/lib/paths/next-step';
import { lockScroll } from '@/lib/dom/scroll-lock';
import { NavRail } from './nav-rail';

export function MobileDrawer({
  open,
  step,
  onClose,
}: {
  open: boolean;
  step: NextStep;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const release = lockScroll();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    surface.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      release();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div
        ref={surface}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <NavRail step={step} />
      </div>
    </div>
  );
}
`,
      ),
      mod(
        'styles/responsive.css',
        `
/* One set of breakpoints, used by every layout in the product. */
@media (max-width: 899px) {
  .shell-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .nav-rail {
    display: none;
  }

  .drawer-toggle {
    display: inline-flex;
  }

  .drawer-scrim {
    position: fixed;
    inset: 0;
    background: rgba(28, 35, 32, 0.3);
  }
}

@media (min-width: 900px) {
  .drawer-toggle {
    display: none;
  }
}
`,
      ),
    ],
  },
];
