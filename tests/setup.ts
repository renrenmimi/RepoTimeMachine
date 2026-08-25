import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Vitest's jsdom environment has no matchMedia; the app reads it for
// prefers-reduced-motion. Tests that need a specific answer override it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// `globals: false` means Testing Library cannot register its own cleanup, so the
// DOM is reset here instead. Guarded, because the node-environment suites have
// no document.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
