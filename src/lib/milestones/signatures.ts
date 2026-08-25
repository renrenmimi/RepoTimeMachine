/**
 * Path patterns used by the milestone heuristics.
 *
 * Each signature is a plain, inspectable rule. It matches file paths — it does
 * not read file contents and it does not know why a file was added.
 */

export type SignatureKind =
  | 'first-readme'
  | 'first-manifest'
  | 'first-lockfile'
  | 'framework-config'
  | 'first-typescript'
  | 'first-test'
  | 'first-ci'
  | 'first-deploy-config'
  | 'first-license';

export type Signature = {
  kind: SignatureKind;
  label: string;
  /** Human-readable statement of the rule, shown in the UI. */
  rule: string;
  test: (path: string) => boolean;
  /** Concrete paths worth probing directly against the commits API. */
  probeCandidates?: (headPaths: readonly string[]) => string[];
};

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'cargo.toml',
  'go.mod', 'gemfile', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'pubspec.yaml', 'mix.exs', 'package.swift', 'project.clj', 'deno.json',
];

const LOCKFILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'poetry.lock', 'cargo.lock', 'go.sum', 'gemfile.lock', 'composer.lock', 'uv.lock',
];

const FRAMEWORK_CONFIGS = [
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'vite.config.js', 'vite.config.ts', 'nuxt.config.ts', 'nuxt.config.js',
  'svelte.config.js', 'astro.config.mjs', 'astro.config.ts', 'remix.config.js',
  'angular.json', 'vue.config.js', 'gatsby-config.js', 'tailwind.config.js',
  'tailwind.config.ts', 'webpack.config.js', 'rollup.config.js', 'metro.config.js',
  'app.json', 'expo.json', 'manage.py', 'artisan', 'config/application.rb',
  'application.properties', 'nest-cli.json',
];

const DEPLOY_CONFIGS = [
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'vercel.json',
  'netlify.toml', 'fly.toml', 'procfile', 'app.yaml', 'render.yaml',
  'serverless.yml', 'now.json', 'railway.json', 'captain-definition',
];

const baseName = (path: string): string => {
  const index = path.lastIndexOf('/');
  return (index === -1 ? path : path.slice(index + 1)).toLowerCase();
};

const isRoot = (path: string): boolean => !path.includes('/');

const pickFromHead = (headPaths: readonly string[], predicate: (p: string) => boolean, limit = 1): string[] =>
  headPaths.filter(predicate).slice(0, limit);

export const SIGNATURES: Signature[] = [
  {
    kind: 'first-readme',
    label: 'First README',
    rule: 'A file named README(.md/.rst/.txt) appears at the repository root.',
    test: (path) => isRoot(path) && /^readme(\.|$)/i.test(baseName(path)),
    probeCandidates: (head) => pickFromHead(head, (p) => isRoot(p) && /^readme(\.|$)/i.test(baseName(p))),
  },
  {
    kind: 'first-manifest',
    label: 'First package manifest',
    rule: `A dependency manifest appears (${MANIFESTS.slice(0, 6).join(', ')}, …).`,
    test: (path) => MANIFESTS.includes(baseName(path)) && path.split('/').length <= 2,
    probeCandidates: (head) => pickFromHead(head, (p) => MANIFESTS.includes(baseName(p)) && p.split('/').length <= 2),
  },
  {
    kind: 'first-lockfile',
    label: 'Dependencies pinned',
    rule: 'A lockfile appears, so dependency versions became reproducible.',
    test: (path) => LOCKFILES.includes(baseName(path)),
    probeCandidates: (head) => pickFromHead(head, (p) => LOCKFILES.includes(baseName(p))),
  },
  {
    kind: 'framework-config',
    label: 'Framework configuration added',
    rule: 'A recognised framework or bundler config file appears.',
    test: (path) => FRAMEWORK_CONFIGS.includes(baseName(path)) || FRAMEWORK_CONFIGS.includes(path.toLowerCase()),
    probeCandidates: (head) => pickFromHead(head, (p) => FRAMEWORK_CONFIGS.includes(baseName(p)), 2),
  },
  {
    kind: 'first-typescript',
    label: 'TypeScript introduced',
    rule: 'tsconfig.json appears, or the first .ts/.tsx file is added.',
    test: (path) => baseName(path) === 'tsconfig.json' || /\.(ts|tsx)$/.test(path),
    probeCandidates: (head) => pickFromHead(head, (p) => baseName(p) === 'tsconfig.json'),
  },
  {
    kind: 'first-test',
    label: 'First test',
    rule: 'A path matching *.test.*, *.spec.*, or a tests/__tests__/e2e directory appears.',
    test: (path) =>
      /\.(test|spec)\.[a-z0-9]+$/i.test(path) ||
      /(^|\/)(tests?|__tests__|specs?|e2e|cypress)\//i.test(path),
    probeCandidates: (head) =>
      pickFromHead(head, (p) => /\.(test|spec)\.[a-z0-9]+$/i.test(p) || /(^|\/)(tests?|__tests__|e2e)\//i.test(p), 2),
  },
  {
    kind: 'first-ci',
    label: 'Continuous integration added',
    rule: 'A CI definition appears (.github/workflows/*, .gitlab-ci.yml, .circleci/*).',
    test: (path) =>
      path.startsWith('.github/workflows/') ||
      baseName(path) === '.gitlab-ci.yml' ||
      path.startsWith('.circleci/') ||
      baseName(path) === '.travis.yml' ||
      baseName(path) === 'azure-pipelines.yml',
    probeCandidates: (head) => pickFromHead(head, (p) => p.startsWith('.github/workflows/')),
  },
  {
    kind: 'first-deploy-config',
    label: 'Deployment configuration added',
    rule: `A deployment descriptor appears (${DEPLOY_CONFIGS.slice(0, 5).join(', ')}, …).`,
    test: (path) => DEPLOY_CONFIGS.includes(baseName(path)) && path.split('/').length <= 2,
    probeCandidates: (head) => pickFromHead(head, (p) => DEPLOY_CONFIGS.includes(baseName(p)) && p.split('/').length <= 2),
  },
  {
    kind: 'first-license',
    label: 'License added',
    rule: 'A LICENSE / COPYING file appears at the root.',
    test: (path) => isRoot(path) && /^(license|licence|copying)(\.|$)/i.test(baseName(path)),
    probeCandidates: (head) => pickFromHead(head, (p) => isRoot(p) && /^(license|licence|copying)(\.|$)/i.test(baseName(p))),
  },
];

export const SIGNATURE_BY_KIND = new Map(SIGNATURES.map((s) => [s.kind, s]));
