'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '@/lib/theme';
import { Overlay } from './Overlay';
import { useMediaQuery } from './hooks';
import styles from './top-bar.module.css';

type Props = {
  /** Short identifier of whatever is open, or null on the home screen. */
  repoLabel: string | null;
  onChangeRepo: () => void;
  onOpenHelp: () => void;
};

/**
 * The one bar that is always there.
 *
 * It holds only what is true of every view: what this is, what is open, and the
 * three global actions. The repository's full name and its data source belong to
 * the content heading, where they can be read rather than skimmed.
 */
export function TopBar({ repoLabel, onChangeRepo, onOpenHelp }: Props) {
  /*
   * Below this width the three global actions and their labels cannot sit in a
   * 56px bar without shrinking the text, so they move into a menu instead. The
   * three views stay where they are — those are the primary navigation.
   */
  const compact = useMediaQuery('(max-width: 767px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const repoAction = repoLabel ? 'Change repository' : 'Open a repository';

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <BrandMark />
        <span className={styles.brandName}>Repo Time Machine</span>
      </div>

      {repoLabel ? (
        <span className={styles.repoChip} title={repoLabel}>
          {repoLabel}
        </span>
      ) : null}

      {compact ? (
        <div className={styles.actions}>
          <button type="button" className={styles.menuButton} onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={onChangeRepo}>
            {repoAction}
          </button>
          <button type="button" className={styles.action} onClick={onOpenHelp}>
            How it works
          </button>
          <ThemeControl />
        </div>
      )}

      {menuOpen ? (
        <Overlay title="Menu" onClose={() => setMenuOpen(false)}>
          <div className={styles.menuBody}>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                onChangeRepo();
              }}
            >
              {repoAction}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenuOpen(false);
                onOpenHelp();
              }}
            >
              How it works
            </button>
            <div className={styles.menuTheme}>
              <p className={styles.menuThemeLabel}>Colour theme</p>
              <ThemeControl />
            </div>
          </div>
        </Overlay>
      ) : null}
    </header>
  );
}

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

/**
 * Light / Dark / System, as a three-way radio group.
 *
 * The preference lives in `localStorage`, which the server cannot read, so it
 * is subscribed to as the external store it is: the server renders `system`,
 * and the client reads the real value as it hydrates. The palette itself is
 * already correct before this renders, because the boot script applied it.
 */
function ThemeControl() {
  const preference = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  return (
    <div className={styles.theme} role="radiogroup" aria-label="Colour theme">
      {THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          className={styles.themeOption}
          aria-checked={preference === option.id}
          onClick={() => setThemePreference(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BrandMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="7" fill="var(--bg-subtle)" stroke="var(--border-subtle)" strokeWidth="1.5" />
      <circle cx="11" cy="12" r="4.2" fill="none" stroke="var(--text-accent)" strokeWidth="1.8" />
      <circle cx="21.5" cy="12" r="2.8" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8" />
      <path d="M11 16.2v3.4a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2v-4.8" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7" y1="25.5" x2="25" y2="25.5" stroke="var(--border-control)" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16" y1="23" x2="16" y2="28" stroke="var(--text-accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
