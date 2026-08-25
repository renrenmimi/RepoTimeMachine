/**
 * File classification used by the tree, the language estimate and the milestone
 * heuristics. Everything here is a guess made from the path alone — no file
 * contents are ever downloaded — so the UI labels the results as estimates.
 */

export type FileKind = 'source' | 'config' | 'docs' | 'style' | 'test' | 'asset' | 'binary' | 'generated' | 'other';

export type FileFacts = {
  path: string;
  name: string;
  extension: string;
  kind: FileKind;
  /** Display language for the composition chart, or null when not counted. */
  language: string | null;
  /** True when the bytes are not human-readable text. */
  isBinary: boolean;
  /** True when the file is machine-written (lockfiles, build output, vendored code). */
  isGenerated: boolean;
};

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'tiff', 'psd',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'mov', 'avi', 'webm', 'mkv',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'jar', 'war',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'class', 'pyc', 'wasm',
  'db', 'sqlite', 'sqlite3', 'mdb',
  'keystore', 'jks', 'p12', 'pfx',
]);

const GENERATED_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'composer.lock', 'gemfile.lock', 'poetry.lock', 'cargo.lock', 'go.sum',
  'pubspec.lock', 'podfile.lock', 'packages.lock.json', 'uv.lock',
]);

const GENERATED_DIRECTORIES = [
  'node_modules', 'vendor', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', '__pycache__', '.venv', 'venv', 'target', 'bin/debug', 'bin/release',
  'derived', 'pods', '.gradle', 'obj', 'migrations/__pycache__',
];

/** Extension → display language. Deliberately coarse: this is a composition estimate. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python',
  rb: 'Ruby', erb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift',
  m: 'Objective-C', mm: 'Objective-C',
  c: 'C', h: 'C',
  cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  cs: 'C#',
  php: 'PHP',
  ex: 'Elixir', exs: 'Elixir',
  dart: 'Dart',
  scala: 'Scala',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  sql: 'SQL',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  html: 'HTML', htm: 'HTML',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
  md: 'Markdown', mdx: 'Markdown',
  json: 'JSON', jsonc: 'JSON',
  yml: 'YAML', yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  graphql: 'GraphQL', gql: 'GraphQL',
  proto: 'Protobuf',
  tf: 'Terraform',
  lua: 'Lua',
  r: 'R',
  pl: 'Perl',
  hs: 'Haskell',
  clj: 'Clojure',
  zig: 'Zig',
};

const CONFIG_FILENAMES = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.prettierrc',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.babelrc', '.dockerignore',
  'dockerfile', 'makefile', 'procfile', 'vercel.json', 'netlify.toml', 'fly.toml',
  'tsconfig.json', 'jsconfig.json', 'package.json', 'go.mod', 'cargo.toml',
  'pyproject.toml', 'requirements.txt', 'gemfile', 'composer.json', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'pubspec.yaml', 'renovate.json',
]);

const TEST_PATH_PATTERN = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)(\/|$)/i;
const TEST_FILE_PATTERN = /\.(test|spec)\.[a-z0-9]+$/i;
const DOC_PATH_PATTERN = /(^|\/)(docs?|documentation)(\/|$)/i;

export function fileName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isGeneratedPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = fileName(lower);
  if (GENERATED_FILENAMES.has(name)) return true;
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css') || lower.endsWith('.map')) return true;
  const segments = lower.split('/');
  for (const dir of GENERATED_DIRECTORIES) {
    if (dir.includes('/')) {
      if (lower.includes(`${dir}/`)) return true;
    } else if (segments.includes(dir)) {
      return true;
    }
  }
  return false;
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(fileExtension(path));
}

export function classifyPath(path: string): FileFacts {
  const name = fileName(path);
  const lowerName = name.toLowerCase();
  const extension = fileExtension(path);
  const isBinary = BINARY_EXTENSIONS.has(extension);
  const isGenerated = isGeneratedPath(path);
  const language = isBinary || isGenerated ? null : (LANGUAGE_BY_EXTENSION[extension] ?? null);

  let kind: FileKind;
  if (isGenerated) kind = 'generated';
  else if (isBinary) kind = 'binary';
  else if (TEST_FILE_PATTERN.test(name) || TEST_PATH_PATTERN.test(path)) kind = 'test';
  else if (extension === 'md' || extension === 'mdx' || DOC_PATH_PATTERN.test(path)) kind = 'docs';
  else if (['css', 'scss', 'sass', 'less'].includes(extension)) kind = 'style';
  else if (CONFIG_FILENAMES.has(lowerName) || lowerName.startsWith('.') || ['json', 'yml', 'yaml', 'toml', 'ini', 'env'].includes(extension)) kind = 'config';
  else if (language) kind = 'source';
  else if (['svg', 'txt', 'csv'].includes(extension)) kind = 'asset';
  else kind = 'other';

  return { path, name, extension, kind, language, isBinary, isGenerated };
}

/** Short label shown next to non-text files in the tree. */
export function kindLabel(kind: FileKind): string | null {
  switch (kind) {
    case 'binary':
      return 'binary';
    case 'generated':
      return 'generated';
    case 'test':
      return 'test';
    default:
      return null;
  }
}
