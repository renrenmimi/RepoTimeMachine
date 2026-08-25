/**
 * The built-in demo history.
 *
 * This is a curated, synthetic history — sixteen invented commits describing how
 * a learning product might plausibly grow. It is **not** a reproduction of any
 * real repository, and none of the file contents, messages, authors or object ids
 * come from one. It exists so the application has something to demonstrate
 * without reading anybody's repository and without spending GitHub quota.
 *
 * The data below is the fixture: object ids, timestamps, subjects and per-file
 * line counts are literals checked into the repository. Trees, statistics and
 * milestones are derived from it by the same code paths a live repository uses.
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

/** How a commit touched one path. Line counts are part of the fixture. */
export type DemoChangeKind = 'added' | 'modified' | 'removed' | 'renamed';

export type DemoChange = {
  kind: DemoChangeKind;
  path: string;
  additions: number;
  deletions: number;
  /** Previous path, for renames. */
  from?: string;
  /** A short synthetic diff, shown in the commit panel. */
  patch?: string;
};

export type DemoCommitSpec = {
  sha: string;
  /** ISO 8601, strictly increasing across the list. */
  date: string;
  subject: string;
  body: string;
  changes: DemoChange[];
};

const add = (path: string, additions: number, patch?: string): DemoChange => ({
  kind: 'added',
  path,
  additions,
  deletions: 0,
  ...(patch ? { patch } : {}),
});

const mod = (path: string, additions: number, deletions: number, patch?: string): DemoChange => ({
  kind: 'modified',
  path,
  additions,
  deletions,
  ...(patch ? { patch } : {}),
});

const del = (path: string, deletions: number): DemoChange => ({
  kind: 'removed',
  path,
  additions: 0,
  deletions,
});

const ren = (from: string, path: string, additions = 0, deletions = 0): DemoChange => ({
  kind: 'renamed',
  path,
  from,
  additions,
  deletions,
});

/**
 * Sixteen commits, oldest first. Exactly sixteen: the count is asserted by the
 * test suite, because the demo's whole point is being a fixed, known history.
 */
export const DEMO_COMMITS: readonly DemoCommitSpec[] = [
  {
    sha: 'efc489e4521d2c40c30fe6fd18678c6219245813',
    date: '2025-01-06T09:12:00Z',
    subject: 'chore: scaffold the application shell',
    body: 'An empty application that builds and serves one page. No product code yet, only the pieces needed to run something.',
    changes: [
      add('package.json', 32, '@@ -0,0 +1,8 @@\n+{\n+  "name": "learning-platform",\n+  "private": true,\n+  "scripts": {\n+    "dev": "next dev",\n+    "build": "next build"\n+  }\n+}'),
      add('tsconfig.json', 27),
      add('.gitignore', 14),
      add('README.md', 21, '@@ -0,0 +1,5 @@\n+# Learning Platform\n+\n+A place to learn something in small, finishable steps.\n+\n+Work in progress.'),
      add('app/layout.tsx', 24),
      add('app/page.tsx', 12, '@@ -0,0 +1,6 @@\n+export default function HomePage() {\n+  return (\n+    <main>\n+      <h1>Learning Platform</h1>\n+    </main>\n+  );\n+}'),
    ],
  },
  {
    sha: 'f19511761fe6afd7fa6ce5fc6e53245967feb9db',
    date: '2025-01-08T14:40:00Z',
    subject: 'feat: establish design tokens and layout primitives',
    body: 'Every colour, spacing step and radius now has one name. Two layout primitives cover the shapes the product actually needs, so pages stop inventing their own margins.',
    changes: [
      add('next.config.ts', 16),
      add('package-lock.json', 1840),
      add('styles/tokens.css', 96, '@@ -0,0 +1,10 @@\n+:root {\n+  --surface-base: #0f1115;\n+  --surface-panel: #16191f;\n+  --text: #e6e6e6;\n+  --text-dim: #9aa0a6;\n+  --accent: #7fb2ff;\n+  --space-2: 0.5rem;\n+  --space-4: 1rem;\n+  --radius: 6px;\n+}'),
      add('styles/global.css', 58),
      add('components/layout/app-shell.tsx', 74),
      add('components/layout/container.tsx', 22),
      add('public/favicon.svg', 9),
      mod('app/layout.tsx', 18, 6),
    ],
  },
  {
    sha: 'cb5a18f82d77821319fda7225a34722ea328f630',
    date: '2025-01-13T10:05:00Z',
    subject: 'feat: define lesson and exercise models',
    body: 'A lesson is a title, a body and an ordered list of exercises. An exercise is a prompt plus a way to check an answer. Everything else in the product is built on these two.',
    changes: [
      add('lib/models/lesson.ts', 64, '@@ -0,0 +1,11 @@\n+export type Lesson = {\n+  slug: string;\n+  title: string;\n+  summary: string;\n+  estimatedMinutes: number;\n+  exercises: Exercise[];\n+};\n+\n+export function lessonDuration(lesson: Lesson): number {\n+  return lesson.exercises.reduce((total, item) => total + item.minutes, 0);\n+}'),
      add('lib/models/exercise.ts', 58),
      add('lib/models/index.ts', 8),
      add('tests/models.test.ts', 46, '@@ -0,0 +1,7 @@\n+import { describe, expect, it } from "vitest";\n+import { lessonDuration } from "../lib/models/lesson";\n+\n+describe("lessonDuration", () => {\n+  it("sums the exercise minutes", () => {\n+    expect(lessonDuration(fixture)).toBe(18);\n+  });\n+});'),
    ],
  },
  {
    sha: 'a909ce5397b9c0af2103c82c216498fb75de9c04',
    date: '2025-01-17T16:22:00Z',
    subject: 'feat: add progress state and local persistence',
    body: 'Progress survives a reload. It is stored per lesson rather than as one blob, so a corrupt entry loses one lesson instead of everything.',
    changes: [
      add('lib/progress/types.ts', 34),
      add('lib/progress/store.ts', 118, '@@ -0,0 +1,9 @@\n+export function markExerciseComplete(state: ProgressState, id: string): ProgressState {\n+  if (state.completed.includes(id)) return state;\n+  return {\n+    ...state,\n+    completed: [...state.completed, id],\n+    updatedAt: Date.now(),\n+  };\n+}'),
      add('lib/progress/storage.ts', 72),
      add('tests/progress.test.ts', 88),
      mod('lib/models/index.ts', 4, 1),
    ],
  },
  {
    sha: '68e631c1cd7a309874ad8fbc39906129410f23df',
    date: '2025-01-23T11:48:00Z',
    subject: 'feat: publish the first guided lesson',
    body: 'One lesson, end to end: read a short explanation, answer three exercises, see progress recorded. Enough to tell whether the shape of the thing works.',
    changes: [
      add('content/lessons/getting-started.mdx', 142),
      add('components/lesson/lesson-view.tsx', 156, '@@ -0,0 +1,8 @@\n+export function LessonView({ lesson }: { lesson: Lesson }) {\n+  return (\n+    <article aria-labelledby="lesson-title">\n+      <h1 id="lesson-title">{lesson.title}</h1>\n+      <ExerciseList exercises={lesson.exercises} />\n+    </article>\n+  );\n+}'),
      add('components/lesson/exercise-list.tsx', 94),
      add('app/lessons/[slug]/page.tsx', 48),
      add('tests/lesson-view.test.tsx', 64),
      mod('app/page.tsx', 22, 4),
    ],
  },
  {
    sha: '62618def3b583489d0125be04e5e77fbcc030556',
    date: '2025-02-03T09:30:00Z',
    subject: 'feat: expand the learning library',
    body: 'Four more lessons, and a grid to find them in. Writing several at once exposed how much of the lesson view assumed a single hard-coded page.',
    changes: [
      add('LICENSE', 21),
      add('content/lessons/reading-errors.mdx', 168),
      add('content/lessons/shaping-data.mdx', 184),
      add('content/lessons/writing-tests.mdx', 176),
      add('content/lessons/asking-questions.mdx', 152),
      add('components/library/library-grid.tsx', 118),
      add('components/library/lesson-card.tsx', 86),
      add('app/library/page.tsx', 54),
      add('lib/content/load-lessons.ts', 92),
      add('tests/library.test.tsx', 78),
      mod('components/lesson/lesson-view.tsx', 46, 38),
      mod('styles/tokens.css', 18, 2),
    ],
  },
  {
    sha: 'f0620b3d28d3e9e64bb8456b7f7212992ea3474a',
    date: '2025-02-11T15:15:00Z',
    subject: 'feat: generate navigation and search indexes',
    body: 'Navigation and search read one generated index instead of walking the content directory at request time. The index is built ahead of time and treated as generated output.',
    changes: [
      add('lib/index/build-index.ts', 134),
      add('lib/index/search.ts', 108, '@@ -0,0 +1,7 @@\n+export function search(index: SearchIndex, query: string): SearchHit[] {\n+  const needle = query.trim().toLowerCase();\n+  if (!needle) return [];\n+  return index.entries\n+    .filter((entry) => entry.haystack.includes(needle))\n+    .slice(0, 20);\n+}'),
      add('components/search/search-dialog.tsx', 146),
      add('public/generated/search-index.json', 620),
      add('scripts/build-index.sh', 34, '@@ -0,0 +1,5 @@\n+#!/usr/bin/env bash\n+set -euo pipefail\n+\n+node ./scripts/build-index.mjs\n+echo "index written"'),
      add('tests/search.test.ts', 96),
      mod('components/layout/app-shell.tsx', 34, 12),
    ],
  },
  {
    sha: '31a8fae638b019a6fa546d527fdd4d0723668bc0',
    date: '2025-02-20T13:02:00Z',
    subject: 'feat: add guided practice sessions',
    body: 'A practice session picks exercises the learner has not finished and asks them in a fixed order, so a session is repeatable rather than random.',
    changes: [
      add('lib/practice/session.ts', 148, '@@ -0,0 +1,8 @@\n+export function buildSession(pool: Exercise[], progress: ProgressState, size: number): Session {\n+  const unfinished = pool.filter((item) => !progress.completed.includes(item.id));\n+  return {\n+    id: sessionId(unfinished, size),\n+    items: unfinished.slice(0, size),\n+  };\n+}'),
      add('lib/practice/scoring.ts', 84),
      add('components/practice/practice-runner.tsx', 162),
      add('components/practice/practice-summary.tsx', 92),
      add('app/practice/page.tsx', 58),
      add('tests/practice.test.ts', 112),
      mod('lib/progress/store.ts', 38, 9),
    ],
  },
  {
    sha: 'fd2d50be85fa72719f4fae7bcaee26cac60792ec',
    date: '2025-03-04T10:41:00Z',
    subject: 'feat: introduce the coding workspace',
    body: 'Some exercises need code, not multiple choice. The workspace runs a snippet against fixed cases in a worker and reports which ones passed. The largest change so far, and the one that most changed the shape of the app.',
    changes: [
      add('lib/workspace/runner.ts', 486),
      add('lib/workspace/worker.ts', 342),
      add('lib/workspace/cases.ts', 218),
      add('components/workspace/editor-pane.tsx', 604),
      add('components/workspace/result-pane.tsx', 296),
      add('components/workspace/workspace-layout.tsx', 244),
      add('app/workspace/page.tsx', 88),
      add('styles/workspace.css', 182),
      add('tests/workspace-runner.test.ts', 268),
      add('tests/workspace-cases.test.ts', 154),
      mod('lib/models/exercise.ts', 68, 14),
      mod('components/lesson/exercise-list.tsx', 52, 22),
    ],
  },
  {
    sha: '47915e96ba5e1d83231f231a800aa842482612e8',
    date: '2025-03-14T17:26:00Z',
    subject: 'feat: add assessment and review modes',
    body: 'Assessment asks without hints and reports at the end. Review comes back to the exercises that were wrong. They share one scoring module so the two can never disagree.',
    changes: [
      add('.github/workflows/ci.yml', 42, '@@ -0,0 +1,9 @@\n+name: CI\n+on: [push, pull_request]\n+jobs:\n+  check:\n+    runs-on: ubuntu-latest\n+    steps:\n+      - uses: actions/checkout@v4\n+      - run: npm ci\n+      - run: npm test'),
      add('lib/assessment/score.ts', 116),
      add('lib/assessment/review.ts', 94),
      add('components/assessment/assessment-runner.tsx', 158),
      add('components/assessment/review-list.tsx', 104),
      add('app/assessment/page.tsx', 56),
      add('tests/assessment.test.ts', 124),
      mod('lib/practice/scoring.ts', 28, 46),
    ],
  },
  {
    sha: '78c2808ce57786285cf655e6a2633962b54718fc',
    date: '2025-03-25T12:08:00Z',
    subject: 'feat: introduce guided learning paths',
    body: 'A path is an ordered set of lessons with a stated goal. Paths are declared as data so adding one is an editorial act rather than a code change.',
    changes: [
      add('content/paths/first-steps.yaml', 46, '@@ -0,0 +1,9 @@\n+slug: first-steps\n+title: First steps\n+goal: Finish something small, all the way through.\n+lessons:\n+  - getting-started\n+  - reading-errors\n+  - writing-tests'),
      add('content/paths/reading-code.yaml', 52),
      add('content/paths/building-confidence.yaml', 58),
      add('lib/paths/resolve.ts', 128),
      add('lib/paths/types.ts', 38),
      add('components/paths/path-card.tsx', 96),
      add('components/paths/path-outline.tsx', 112),
      add('app/paths/page.tsx', 54),
      add('tests/paths.test.ts', 106),
    ],
  },
  {
    sha: 'a97b30455ee5375b9e0c2e0e1b0f44f4c4617588',
    date: '2025-04-02T09:55:00Z',
    subject: 'feat: make progress and continuation plan-aware',
    body: 'Progress now knows which path a learner is on, so "continue" means the next step in that path rather than the next lesson in the library.',
    changes: [
      add('lib/progress/plan.ts', 142, '@@ -0,0 +1,8 @@\n+export function nextStep(plan: Plan, progress: ProgressState): Step | null {\n+  for (const step of plan.steps) {\n+    if (!progress.completed.includes(step.id)) return step;\n+  }\n+  return null;\n+}'),
      add('lib/paths/next-step.ts', 88),
      add('tests/plan.test.ts', 118),
      mod('lib/progress/store.ts', 64, 22),
      mod('lib/progress/types.ts', 26, 6),
      mod('lib/paths/resolve.ts', 34, 11),
    ],
  },
  {
    sha: '69e42370ba56d099c90b917746e446679d14c7ce',
    date: '2025-04-11T14:33:00Z',
    subject: 'refactor: unify navigation and next actions',
    body: 'Four places decided what "next" meant and two of them disagreed. There is now one navigation module, and the duplicates are gone.',
    changes: [
      add('components/navigation/nav-rail.tsx', 128),
      add('components/navigation/next-action.tsx', 86),
      add('components/navigation/mobile-drawer.tsx', 142),
      add('lib/navigation/resolve-next.ts', 104),
      ren('components/library/lesson-card.tsx', 'components/library/library-card.tsx', 12, 8),
      del('components/practice/practice-summary.tsx', 92),
      del('components/paths/path-outline.tsx', 112),
      mod('components/layout/app-shell.tsx', 58, 74),
      mod('app/practice/page.tsx', 22, 18),
      mod('app/paths/page.tsx', 24, 16),
      mod('tests/paths.test.ts', 18, 22),
    ],
  },
  {
    sha: '99e7880a3699caf73dbe932dff20d854140cc843',
    date: '2025-04-22T11:19:00Z',
    subject: 'feat: add dashboard progress views',
    body: 'One screen that answers "where am I": what is finished, what is next, and how much of the current path is left. Read-only, derived entirely from stored progress.',
    changes: [
      add('vercel.json', 12),
      add('lib/stats/summary.ts', 132, '@@ -0,0 +1,8 @@\n+export function summarise(progress: ProgressState, plan: Plan): Summary {\n+  const done = plan.steps.filter((step) => progress.completed.includes(step.id));\n+  return {\n+    completed: done.length,\n+    total: plan.steps.length,\n+    share: plan.steps.length === 0 ? 0 : done.length / plan.steps.length,\n+  };\n+}'),
      add('components/dashboard/progress-ring.tsx', 108),
      add('components/dashboard/streak-strip.tsx', 92),
      add('components/dashboard/dashboard-grid.tsx', 116),
      add('app/dashboard/page.tsx', 64),
      add('tests/summary.test.ts', 96),
      mod('components/navigation/nav-rail.tsx', 26, 8),
    ],
  },
  {
    sha: '1fc9a6407085795e6f6f7ecb194c41138be153b4',
    date: '2025-05-06T16:04:00Z',
    subject: 'fix: align responsive layouts and accessibility',
    body: 'A pass with a keyboard and a narrow window. Focus order follows reading order, the workspace stops overflowing at 360px, and every control states what it does.',
    changes: [
      add('styles/responsive.css', 88),
      add('tests/accessibility.test.tsx', 134),
      mod('components/workspace/workspace-layout.tsx', 52, 34),
      mod('components/workspace/editor-pane.tsx', 38, 26),
      mod('components/dashboard/dashboard-grid.tsx', 34, 18),
      mod('components/navigation/nav-rail.tsx', 42, 24),
      mod('components/lesson/lesson-view.tsx', 28, 16),
      mod('styles/global.css', 46, 22),
      mod('styles/tokens.css', 22, 8),
    ],
  },
  {
    sha: '49b79263eceed79350be604175fe8d0ff9d112a7',
    date: '2025-05-14T10:27:00Z',
    subject: 'fix: lock background scrolling behind the mobile drawer',
    body: 'Opening the drawer on a phone left the page behind it scrollable, and closing it lost the reading position. The lock records the offset, fixes the body while the drawer is open, and restores the offset on close.',
    changes: [
      add('lib/dom/scroll-lock.ts', 78, '@@ -0,0 +1,10 @@\n+export function lockScroll(): () => void {\n+  const offset = window.scrollY;\n+  document.body.style.position = "fixed";\n+  document.body.style.top = `-${offset}px`;\n+  return () => {\n+    document.body.style.position = "";\n+    document.body.style.top = "";\n+    window.scrollTo(0, offset);\n+  };\n+}'),
      add('tests/scroll-lock.test.ts', 92),
      mod('components/navigation/mobile-drawer.tsx', 44, 18),
      mod('styles/responsive.css', 16, 4),
    ],
  },
];

/** Release tags, so the demo exercises the tag milestone too. */
export const DEMO_TAGS: readonly { name: string; commitIndex: number }[] = [
  { name: 'v0.1.0', commitIndex: 4 },
  { name: 'v1.0.0', commitIndex: 13 },
];

export const DEMO_CREATED_AT = DEMO_COMMITS[0]!.date;
export const DEMO_PUSHED_AT = DEMO_COMMITS[DEMO_COMMITS.length - 1]!.date;
