# Repo Time Machine

Turn the Git history of a public GitHub repository into a timeline you can play.

Paste `owner/repository` or a GitHub URL. Repo Time Machine loads the default
branch, reconstructs the file tree at each commit, and lets you scrub or play
through the history while the tree fills in, files change, and the commit detail
follows along.

It answers questions that are awkward to answer on GitHub itself:

- what existed at the beginning;
- which files and folders appeared next;
- when a framework or an architecture became visible;
- what a particular commit actually changed;
- which parts of the repository were busy at which times;
- how a handful of files turned into an application.

No login. No cloning. Public repositories only.

---

## Why it exists

Reading a repository's history usually means paging through a commit list, which
tells you what happened but not what the project *looked like* at the time. The
useful question is often "what did this become, and when" — and that is a
question about the tree, not about the log.

This is also a portfolio project, so it is deliberately built to be honest about
what it knows. GitHub's API does not hand out a cheap answer to "what did the
tree look like at commit N", and most tools that claim to show it are quietly
guessing. This one says which parts it measured and which parts it inferred.

## Demos

Four repositories with different history shapes:

| Repository | Commits | What it shows |
| --- | --- | --- |
| [`renrenmimi/renren-across-tabs`](https://github.com/renrenmimi/renren-across-tabs) | ~5 | The whole history fits on one screen. |
| [`renrenmimi/DataData`](https://github.com/renrenmimi/DataData) | ~32 | A course project that grew a structure early. |
| [`renrenmimi/DrillLab`](https://github.com/renrenmimi/DrillLab) | ~64 | A few days of work with a visible framework moment. |
| [`renrenmimi/PetNote`](https://github.com/renrenmimi/PetNote) | ~246 | Months of history; shows the loaded-range limits. |

Any other public repository works too.

## What "loaded history" means

This is the part most similar tools are vague about, so it is stated everywhere
in the interface.

The timeline covers a **contiguous range of commits ending at the tip of the
default branch**. On load, up to the latest **300 commits** are fetched (three
pages of 100). If the repository has fewer than that, the whole history is
loaded and the label reads `full history — 64 commits`. If it has more, the label
reads `latest 300 of 1,204 commits`, and the Commits tab offers
`Load 100 older commits`, up to a hard ceiling of 1,000.

Consequences worth knowing:

- For a large repository, commit #1 on the timeline is **not** the repository's
  first commit. It is the oldest commit currently loaded.
- Only the default branch is read. Work that lives on other branches is invisible
  unless it was merged.
- Commit counts come from GitHub's pagination header, so they are exact rather
  than estimated — but they count the default branch only.

## How the file tree is reconstructed

GitHub offers two relevant primitives, and neither one alone is enough:

| Request | Cost | What it gives |
| --- | --- | --- |
| `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` | 1 request | The **exact** file list at one commit. |
| `GET /repos/{o}/{r}/commits/{sha}` | 1 request | The **exact** diff of one commit. |

Fetching a tree per commit would be one request per frame of playback, which is
untenable. So the application reads full trees at a bounded number of
**checkpoint commits** spread across the loaded range, and fetches per-commit
diffs in the background. Any position on the timeline is then *"the nearest
checkpoint at or before here, plus every diff since"*.

The tree panel states which case it is in:

- **`exact`** — a tree was read at this very commit.
- **`rebuilt`** — a checkpoint plus a complete, unbroken chain of diffs. Also exact,
  just assembled rather than read.
- **`≈ n gaps`** — a checkpoint plus diffs, with `n` commits in between whose diffs
  have not loaded yet. Click it to jump to the checkpoint it was built from.

When you stop on a commit, one extra tree request upgrades that position to
`exact`. That deliberately does not happen during playback.

### Limitations of this approach

- **Between checkpoints, before the diffs arrive, the tree lags.** It is the
  checkpoint's tree, not this commit's. The badge says so; it is never presented
  as certain.
- **Files known only from a diff have no size.** A tree response carries blob
  sizes; a diff does not. Those files show no size, and byte-based statistics say
  they are partial.
- **Very large repositories get truncated trees.** GitHub truncates a recursive
  tree above roughly 100,000 entries or 7 MB and sets a flag. The application
  passes that flag through as a notice rather than silently showing a short list.
- **A commit's file list is capped at 300 by GitHub.** Commits that touch more
  files show the first 300 with a note.
- **Rename detection is GitHub's.** A rename is shown as the old path leaving and
  the new path arriving, with "renamed from …" recorded.
- **No submodules.** Submodule pointers are dropped from the tree.
- **Force-pushes and rewritten history** are invisible: the API only reports the
  branch as it stands now.

## GitHub API architecture

```
browser ──same-origin fetch──▶ Next.js route handler ──▶ api.github.com
             (JSON)                  (holds the token)
```

The browser never talks to GitHub. Every request goes through a route handler
under `/api/gh/*`, which means the token stays on the server and the Content
Security Policy can restrict `connect-src` to `'self'`.

| Route | GitHub endpoint | Cache |
| --- | --- | --- |
| `/api/gh/repo` | `/repos/{o}/{r}` | 300s |
| `/api/gh/commits` | `/repos/{o}/{r}/commits` | 300s |
| `/api/gh/commit` | `/repos/{o}/{r}/commits/{sha}` | 86400s |
| `/api/gh/tree` | `/repos/{o}/{r}/git/trees/{sha}?recursive=1` | 86400s |
| `/api/gh/tags` | `/repos/{o}/{r}/tags` | 600s |
| `/api/gh/probe` | `/repos/{o}/{r}/commits?path=…` | 3600s |

A domain adapter (`src/lib/github/adapter.ts`) maps REST payloads to the types in
`src/lib/domain/types.ts`. Nothing above that layer sees a raw GitHub response,
so the UI does not depend on the shape of GitHub's JSON.

### Request budget for one repository view

| Data | Requests |
| --- | --- |
| Repository metadata | 1 |
| Commit list | 1 per 100 commits, 3 pages automatically |
| Exact commit count | 1 (`per_page=1`, read from the `Link` header) |
| Tags | 1 |
| Tree checkpoints | up to 10 with a token, 3 without |
| Commit diffs | background: up to 400 with a token, 12 without |
| Milestone path probes | up to 10, only with a token |

Two rules keep this in bounds:

- **Nothing is fetched per commit during the initial load.** Metadata, commits,
  tags and two trees are enough to render; everything else arrives afterwards.
- **Background work stops** when the observed remaining quota drops below a floor
  (60 authenticated, 12 anonymous), and is **cancelled outright** when the visitor
  switches repository.

### Caching

Three layers, each doing a different job:

1. **Next.js data cache** (server). `fetch(..., { next: { revalidate } })`. Because
   commit diffs and trees are addressed by sha they are immutable, so they are
   cached for a day; listings for five minutes. A second visitor opening the same
   repository mostly costs nothing.
2. **HTTP cache headers** (CDN). Responses carry
   `Cache-Control: public, s-maxage=…, stale-while-revalidate=…`. Errors carry
   `no-store`.
3. **In-memory LRU with in-flight de-duplication** (browser). Scrubbing back and
   forth never refetches. Concurrent callers asking for the same commit share one
   request. Nothing is written to `localStorage` — GitHub payloads are far too
   large for it, and a stale copy would outlive a force-push.

## Rate limits

GitHub allows **60 requests per hour per IP** without a token and **5,000 per
hour** with one. The application works either way; without a token it loads fewer
trees and fewer diffs and says so in the interface.

The header shows the quota **as last observed**, not as of now. That wording is
deliberate: a response replayed from the data cache carries the rate-limit headers
from when it was first fetched, so presenting the number as live would be a small
lie. Hover it for the exact age and reset time.

When the limit is reached, the error state names the limit, shows when the window
resets, and explains that a self-hosted deployment can raise it with a token.

## Optional token setup

A token is optional and only raises the rate limit. Repo Time Machine reads
public repositories, so it needs **no scopes at all**.

```bash
cp .env.example .env.local
# then edit .env.local
GITHUB_TOKEN=github_pat_...
```

- Classic token: create it with **no scopes ticked**.
- Fine-grained token: **Public repositories (read-only)** is enough.

On Vercel, add `GITHUB_TOKEN` as a **server-side** environment variable. Do not
prefix it with `NEXT_PUBLIC_`; that prefix is what makes a variable public.

## Security

The one value a visitor controls is the repository reference, so that is where
the boundary is drawn.

- **`parseRepoRef` is the only way in.** It accepts `owner/repo`, GitHub web URLs
  and clone URLs; it rejects other hosts (including GitHub Enterprise and
  `raw.githubusercontent.com`), GitHub product routes such as `/settings/x`,
  path traversal, and names GitHub itself would not allow. It returns only an
  `owner` and a `repo` — never a host, a base URL, or a path fragment.
- **API URLs are assembled from a constant origin** plus URL-encoded path
  segments. `https://api.github.com` is a module constant, never a parameter.
  There is no code path that fetches a URL supplied by a visitor.
- **The token never leaves the server.** It is read inside route handlers only, is
  never logged, never embedded in HTML, and never appears in a response body. The
  e2e suite asserts this against the real production build.
- **Repository content is treated as untrusted text.** Commit messages, author
  names, file paths, patches and descriptions are rendered as React text nodes.
  There is no `dangerouslySetInnerHTML` anywhere, and `react/no-danger` is an
  error in the lint config. Repository markdown is not rendered as HTML.
- **Repository code is never executed**, never cloned, and never written to disk.
- **Limits everywhere.** 12s request timeout, 12 MB response ceiling, 12,000
  characters per patch, 240,000 per commit, 300 files per commit, 1,000 commits
  per session, 40,000 tracked files, 200-character probe paths.
- **Security headers** on every response: `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP that limits
  `connect-src` to `'self'` and forbids framing.

## Milestone heuristics

The Milestones tab marks commits that look structurally interesting. Every entry
states the rule that fired and the evidence, because these are pattern matches —
**they do not know what anyone intended.**

Rules that need only commit metadata, so they always apply:

| Milestone | Rule |
| --- | --- |
| Initial commit | The commit has no parent. |
| Merge commit | The commit has more than one parent. |
| Marked breaking | The message uses the Conventional Commits `!` marker or a `BREAKING CHANGE:` footer. |
| Revert | The subject begins with "Revert". |
| Tagged *x* | A Git tag points at this commit. |

Rules that read file paths:

| Milestone | Rule |
| --- | --- |
| First README | A `README(.md/.rst/.txt)` appears at the repository root. |
| First package manifest | A dependency manifest appears (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, …). |
| Dependencies pinned | A lockfile appears. |
| Framework configuration added | A recognised framework or bundler config appears. |
| TypeScript introduced | `tsconfig.json`, or the first `.ts`/`.tsx` file. |
| First test | A `*.test.*`, `*.spec.*`, or a `tests/`, `__tests__/`, `e2e/` directory. |
| Continuous integration added | `.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/*`, … |
| Deployment configuration added | `Dockerfile`, `vercel.json`, `netlify.toml`, `fly.toml`, … |
| License added | A `LICENSE`/`COPYING` file at the root. |
| Structural change | At least three top-level directories appear for the first time in one commit. |
| *Language* appears | A file extension mapped to that language is added for the first time in the range. |
| Unusually large change | Changed lines are at least 4× the median of the commits inspected, and at least 400. |

Each path milestone also reports **how sure it is about the position**:

- **exact** — a diff we hold adds a matching path in this commit;
- **confirmed by path history** — GitHub's path-scoped commit listing named the
  commit that first touched the path;
- **narrowed to commits X–Y** — we only know it happened somewhere in that range,
  because the diffs in between are not loaded. It is anchored at the earliest
  commit it could be, and drawn faintly on the timeline.

### Limitations of the heuristics

- **A file's first appearance is not the same as a decision.** `package.json`
  appearing tells you a manifest exists from then on, nothing more.
- **The lists are finite.** A framework not in the table produces no milestone.
  The rules are in `src/lib/milestones/signatures.ts` and are meant to be read.
- **Path probes follow the file as it exists at HEAD.** If a signature file was
  renamed, the probe finds the current path's history, not the original's.
- **"Unusually large" is relative to what has been inspected.** Load more diffs
  and the median moves, so the set can change.
- **`Marked breaking` reports a label, not an analysis.** Nothing checks whether
  anything actually broke.
- **Language detection is extension-based.** A `.ts` file appearing is not proof
  that a project "moved to TypeScript".

## Statistics

The growth view shows cumulative file count, per-commit additions and deletions,
an estimated file-type mix, and where work happened.

Every part is labelled with what it is:

- **File count** is drawn solid where the diff chain is complete and **dashed**
  where a count is carried forward from a checkpoint because the diffs in between
  have not loaded.
- **Churn bars** are drawn only for commits whose diff is loaded. Commits without
  one get a flat marker, not a zero.
- **File-type mix** is an *estimate*. It counts files by extension, skips binary
  and generated paths (lockfiles, `node_modules`, build output, minified files),
  and reports how many it excluded and how many it could not classify. It is not
  GitHub's Linguist and does not read file contents.
- **Byte totals** cover only files that came from a tree snapshot, and say so when
  they are partial.
- **Where work happened** attributes changed files to their top-level directory in
  time buckets, and states how many diffs it was built from.

Charts have a text alternative: the growth chart has a "Read this chart as a
table" disclosure with the sampled values, and every chart carries a descriptive
`aria-label`.

## Accessibility

- The scrubber is a real `<input type="range">`, so it comes with keyboard
  support, touch dragging and assistive-technology semantics. Its `aria-valuetext`
  reads out the commit number, date and subject.
- Keyboard controls: `Space`/`k` play-pause, `←`/`→` step, `Shift+←`/`Shift+→`
  jump ten, `Home`/`End` ends of range, `[`/`]` speed, `/` focus the path filter.
  Shortcuts stand down while a text field has focus.
- Focus is never trapped. A skip link is the first thing in the tab order.
- `prefers-reduced-motion: reduce` replaces transitions with immediate state
  changes — every duration token collapses to 1ms and looping animations are
  switched off rather than merely shortened. Playback itself still works.
- Change states are conveyed by more than colour: markers change shape, deleted
  paths are struck through, and each row carries visually hidden text such as
  "added in this commit".
- The insights panel is a proper tab list with arrow-key navigation.
- No horizontal scrolling at 360px, checked by an assertion rather than by eye.

## Performance

Explicit goals, and how they are met:

| Goal | How |
| --- | --- |
| The shell paints before any GitHub data | The page is static; the client reads the address bar in an effect and fetches after mount. An e2e test asserts zero API calls on the landing screen. |
| No thousands of DOM nodes | Both the file tree and the commit list are virtualised at a fixed row height, with a `maxRows` ceiling on the tree. |
| No repeated fetching | LRU plus in-flight de-duplication in the browser, plus the Next.js data cache on the server. Trees GitHub refused are remembered so they are not retried. |
| Sequential playback stays cheap | Tree projections are cached per commit index and each step reuses the previous one, so stepping forward is O(1) amortised rather than replaying the whole range. |
| No blocking work every frame | Playback is one `setInterval` tick per commit (850ms at 1×, floored at 90ms at 8×). Scroll handlers coalesce into one state update per frame. |
| No layout shift | The loading state reserves height, and panel widths are fixed by the grid rather than by content. |
| No hydration warnings | The server renders the idle shell; nothing reads `window` during render. |
| Few client dependencies | Runtime dependencies are `next`, `react`, `react-dom`, and `server-only`. Charts are hand-written SVG; virtualisation is about forty lines. |
| No large payloads in `localStorage` | Nothing is written to `localStorage` at all. |

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest, 336 tests, no network
npm run test:e2e    # production build + playwright, 112 tests, no network
npm run verify      # all four, in order
```

**No test in the standard suite touches the network.**

### Unit and integration (Vitest)

Deterministic, fixture-driven coverage of: URL and `owner/repo` parsing including
non-GitHub hosts and traversal attempts; the REST-to-domain adapter including
truncated, binary and missing patches; tree reconstruction including renames,
deletions and partial diff coverage; commit ordering and pagination boundaries;
the milestone rules and their three levels of positional confidence; playback
transitions; URL serialisation; the LRU and its de-duplication; and the request
budget, including stale-request cancellation on repository switch and the
rate-limit floor stopping background work.

Component tests (jsdom) cover the transport controls, the tree markers and the
patch fallbacks, including that hostile commit messages, author names, file names
and patch content render as text and create no elements.

### End-to-end (Playwright)

Playwright runs against a **real production build**. `RTM_FIXTURE_MODE=1` makes
the route handlers serve recorded payloads from `fixtures/` instead of calling
GitHub, so the suite exercises the whole stack — routing, cache headers,
hydration, client behaviour — without depending on GitHub's availability or
spending rate limit. **No token is provided**, so the suite also proves the
anonymous path works.

Three projects: desktop, a Pixel 7 for the narrow layout, and a browser reporting
`prefers-reduced-motion: reduce`.

### Fixtures

`fixtures/` holds sanitised recordings from public repositories, plus synthetic
bundles for the cases GitHub cannot provide on demand: a one-commit repository,
an empty repository, a 640-commit history, and directives that make the server
produce rate-limit, private-repository and timeout failures.

Sanitising drops e-mail addresses and avatar URLs, keeps only the fields the
application reads, and caps patches. A detail bundle stores only what a
commit-detail response adds over the list response, and a tree for any commit is
derived from the nearest recorded one plus the diffs in between — the same
reconstruction the client performs. That keeps the whole fixture set to about
1.5 MB of JSON.

Re-record with:

```bash
GITHUB_TOKEN=... npm run fixtures
```

### Optional live smoke test

Kept separate on purpose, so the standard suite never depends on GitHub:

```bash
npm run build
npx next start -p 3311 &
RTM_BASE_URL=http://127.0.0.1:3311 npm run test:live
```

It checks the adapter against what GitHub actually returns today: ordering,
pagination totals, patch caps, tree entry types, and that a malformed owner is
rejected before any request goes out. About ten requests.

### Screenshots

```bash
RTM_FIXTURE_MODE=1 npx next start -p 3311 &
RTM_BASE_URL=http://127.0.0.1:3311 npm run screenshots
```

Writes deterministic desktop, 390px and 360px screenshots to
`docs/screenshots/` (not committed) and reports any horizontal overflow or
console error it finds along the way.

## Local development

Requires Node 20.9+ (developed on Node 22).

```bash
npm install
npm run dev            # http://localhost:3000
```

A token is optional; see [Optional token setup](#optional-token-setup). Without
one you get 60 requests per hour, which is enough for a few repositories.

To run the app against fixtures instead of GitHub:

```bash
RTM_FIXTURE_MODE=1 npm run dev
```

## Deployment

Deploys as a standard Next.js App Router application; it was built with Vercel in
mind but needs nothing Vercel-specific.

```bash
vercel            # preview
vercel --prod     # production
```

Configuration:

- `GITHUB_TOKEN` — optional, **server-side only**. Never prefix it with
  `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SITE_URL` — optional, used for canonical and Open Graph URLs.

There is no database and no persistent state. Every instance is stateless; the
only cache is Next.js's data cache and whatever the CDN keeps.

## Project structure

```
src/
  app/
    api/gh/*/route.ts   route handlers; the only code that talks to GitHub
    layout.tsx          metadata, fonts, theme
    page.tsx            static shell
    icon.svg            favicon
    opengraph-image.tsx build-time Open Graph card
  components/           the interface, one CSS module per component
  lib/
    repo-ref.ts         input parsing and validation (the security boundary)
    domain/types.ts     the types the UI works against
    github/             HTTP client, adapter, service, fixtures, rate-limit store
    api/                route/response contract shared by server and client
    client/             browser API layer and the history controller
    tree/               file classification, tree building, projection
    milestones/         signature paths and the detection rules
    stats/              growth, language estimate, activity map
    playback/machine.ts the pure playback reducer
    url/state.ts        URL serialisation
    cache/lru.ts        LRU with in-flight de-duplication
  styles/tokens.css     every colour, size, duration and radius
fixtures/               recorded and synthetic GitHub payloads
scripts/                fixture recorder, live smoke test, screenshots
tests/                  Vitest
e2e/                    Playwright
```

The pieces worth reading first are `src/lib/tree/projector.ts` (how a tree is
reconstructed) and `src/lib/client/history-controller.ts` (how requests are
budgeted and cancelled).

## Licence

MIT. See [LICENSE](LICENSE).

Repo Time Machine is not affiliated with GitHub. It uses GitHub's public REST API
as any client would.
