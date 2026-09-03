/**
 * Contrast, measured from the stylesheet rather than eyeballed.
 *
 * The README claims every text role clears 4.5:1 against every surface it is
 * used on, and every operable edge clears 3:1, in both themes. A claim like that
 * decays the first time somebody nudges a hex value, so it is asserted here
 * against the same file the application ships.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** The custom properties declared inside one selector block. */
function tokens(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  expect(start, `${selector} is missing from tokens.css`).toBeGreaterThan(-1);

  // The block ends at the first `}` that closes it; nothing here nests.
  const open = CSS.indexOf('{', start);
  const end = CSS.indexOf('\n}', open);
  const body = CSS.slice(open, end);

  const found = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

type Rgb = { r: number; g: number; b: number };

function parse(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  }
  throw new Error(`cannot parse colour: ${value}`);
}

/** Composites a possibly translucent colour over an opaque one. */
function over(value: string, backdrop: Rgb): Rgb {
  const alpha = /^rgba?\([^)]*[,/]\s*([\d.]+)\s*\)$/.exec(value);
  const colour = parse(value);
  if (!alpha) return colour;
  const a = Number(alpha[1]);
  return {
    r: colour.r * a + backdrop.r * (1 - a),
    g: colour.g * a + backdrop.g * (1 - a),
    b: colour.b * a + backdrop.b * (1 - a),
  };
}

/** Relative luminance, per WCAG 2.1. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A pair that must hold, and the threshold it is held to.
 *
 * `4.5` for anything a person reads as text; `3` for a border, a focus ring, a
 * chart stroke or a large numeral — the non-text minimum. Nothing is listed at a
 * threshold lower than WCAG allows for its role.
 */
type Pair = { fg: string; bg: string; min: number };

/** The surfaces ordinary text sits on. */
const SURFACES = ['--bg-page', '--bg-surface', '--bg-subtle', '--bg-hover', '--bg-selected'];

const PAIRS: Pair[] = [
  // Body and metadata text, on every surface a panel can present.
  ...SURFACES.flatMap((bg) => [
    { fg: '--text-primary', bg, min: 4.5 },
    { fg: '--text-secondary', bg, min: 4.5 },
    { fg: '--text-muted', bg, min: 4.5 },
  ]),

  // The accent is used for links and the selected tab label, so it is text.
  { fg: '--text-accent', bg: '--bg-page', min: 4.5 },
  { fg: '--text-accent', bg: '--bg-surface', min: 4.5 },
  { fg: '--text-accent', bg: '--bg-subtle', min: 4.5 },
  { fg: '--text-accent', bg: '--bg-selected', min: 4.5 },

  // The filled button, in all three of its states.
  { fg: '--action-text', bg: '--action-bg', min: 4.5 },
  { fg: '--action-text', bg: '--action-hover', min: 4.5 },
  { fg: '--action-text', bg: '--action-pressed', min: 4.5 },

  // Status messages, each on its own tinted panel.
  { fg: '--info-text', bg: '--info-bg', min: 4.5 },
  { fg: '--warning-text', bg: '--warning-bg', min: 4.5 },
  { fg: '--error-text', bg: '--error-bg', min: 4.5 },
  { fg: '--success-text', bg: '--success-bg', min: 4.5 },

  // Diff rows: the tinted background is the row, the text is the code on it.
  { fg: '--diff-add-text', bg: '--diff-add-bg', min: 4.5 },
  { fg: '--diff-remove-text', bg: '--diff-remove-bg', min: 4.5 },
  { fg: '--diff-hunk-text', bg: '--diff-hunk-bg', min: 4.5 },
  { fg: '--code-text', bg: '--diff-add-bg', min: 4.5 },
  { fg: '--code-text', bg: '--diff-remove-bg', min: 4.5 },

  // Code, on the code surface.
  { fg: '--code-text', bg: '--code-bg', min: 4.5 },
  { fg: '--code-comment', bg: '--code-bg', min: 4.5 },
  { fg: '--code-keyword', bg: '--code-bg', min: 4.5 },
  { fg: '--code-string', bg: '--code-bg', min: 4.5 },
  { fg: '--code-number', bg: '--code-bg', min: 4.5 },

  // Operable edges and rings: the non-text threshold.
  { fg: '--border-control', bg: '--bg-page', min: 3 },
  { fg: '--border-control', bg: '--bg-surface', min: 3 },
  { fg: '--focus-ring', bg: '--bg-page', min: 3 },
  { fg: '--focus-ring', bg: '--bg-surface', min: 3 },
  { fg: '--focus-ring', bg: '--bg-subtle', min: 3 },
  { fg: '--action-bg', bg: '--bg-surface', min: 3 },

  // Chart strokes carry meaning, so they are held to the non-text minimum.
  { fg: '--chart-line', bg: '--bg-surface', min: 3 },
  { fg: '--chart-line', bg: '--bg-page', min: 3 },
  { fg: '--compare-from', bg: '--bg-surface', min: 3 },
  { fg: '--compare-to', bg: '--bg-surface', min: 3 },

  // Categorical dots sit beside a text label, and are still legible alone.
  ...Array.from({ length: 8 }, (_, i) => ({ fg: `--cat-${i + 1}`, bg: '--bg-surface', min: 3 })),
];

const THEMES = [
  { name: 'light', selector: ':root {' },
  { name: 'dark', selector: ":root[data-theme='dark'] {" },
] as const;

describe.each(THEMES)('$name theme contrast', ({ selector }) => {
  const palette = tokens(selector);

  it('declares every token the pairs refer to', () => {
    const missing = new Set<string>();
    for (const pair of PAIRS) {
      if (!palette.has(pair.fg)) missing.add(pair.fg);
      if (!palette.has(pair.bg)) missing.add(pair.bg);
    }
    expect([...missing]).toEqual([]);
  });

  it.each(PAIRS)('$fg on $bg is at least $min:1', ({ fg, bg, min }) => {
    const page = parse(palette.get('--bg-page')!);
    const background = over(palette.get(bg)!, page);
    const foreground = over(palette.get(fg)!, background);
    const measured = ratio(foreground, background);

    // Reported to two places so a failure message says how far short it fell.
    expect(Number(measured.toFixed(2)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  });
});

describe('the palettes stay in step', () => {
  it('declares the same token names in both themes', () => {
    const light = [...tokens(':root {').keys()].sort();
    const dark = [...tokens(":root[data-theme='dark'] {").keys()].sort();
    // `color-scheme` is a real property, not a token, so it is not in either map.
    expect(dark).toEqual(light);
  });

  it('keeps the media-query fallback identical to the explicit dark theme', () => {
    // Two places declare the dark palette: `[data-theme='dark']` for an explicit
    // choice, and a `prefers-color-scheme` block for a visitor who made none. A
    // value that drifts between them would give the same person two palettes.
    const explicit = tokens(":root[data-theme='dark'] {");
    const implied = tokens(":root:not([data-theme='light']):not([data-theme='dark']) {");
    expect(Object.fromEntries(implied)).toEqual(Object.fromEntries(explicit));
  });

  it('hover is fainter than selection, so only one row reads as current', () => {
    for (const { selector } of THEMES) {
      const palette = tokens(selector);
      const page = parse(palette.get('--bg-page')!);
      const surface = parse(palette.get('--bg-surface')!);
      const hover = ratio(over(palette.get('--bg-hover')!, page), surface);
      const selected = ratio(over(palette.get('--bg-selected')!, page), surface);
      expect(hover, `${selector} hover vs surface`).toBeLessThan(selected);
    }
  });
});
