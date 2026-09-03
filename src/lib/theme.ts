/**
 * Theme preference, shared by the boot script and the theme control.
 *
 * The stored value is the *preference* — including `system` — while the
 * `data-theme` attribute always holds the resolved palette. Keeping the two
 * apart is what lets "System" keep following the operating system after a
 * reload instead of freezing whichever palette happened to be active.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'rtm-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Reads the stored preference, defaulting to `system`. */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the interface
    // still works, it just cannot remember the choice.
    return 'system';
  }
}

/**
 * Puts the resolved palette on the document element.
 *
 * `system` removes the attribute entirely rather than writing a value, so the
 * stylesheet's `prefers-color-scheme` block takes over and the palette keeps
 * following the operating system with no JavaScript involved.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/**
 * The preference as an external store.
 *
 * It genuinely is one — it lives in `localStorage` and on the document element,
 * neither of which React owns — so `useSyncExternalStore` reads it directly.
 * That also gives the control its `system` value during hydration without an
 * effect that sets state on mount.
 */
const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Strings compare by value, so this snapshot is stable without a cache. */
export function getThemeSnapshot(): ThemePreference {
  return readThemePreference();
}

/** The server cannot know the choice, so it renders the default. */
export function getThemeServerSnapshot(): ThemePreference {
  return 'system';
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* nothing to do: the theme still applies for this session */
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

/**
 * The pre-paint script, as source text.
 *
 * Deliberately tiny and defensive: it runs before anything else on the page, so
 * a throw here would be a blank screen.
 */
export const THEME_BOOTSTRAP = `try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p==='light'||p==='dark'){document.documentElement.setAttribute('data-theme',p)}}catch(e){}`;
