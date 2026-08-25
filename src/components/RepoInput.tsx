'use client';

import { useId, useRef, useState } from 'react';
import { parseRepoRef, type RepoRef } from '@/lib/repo-ref';
import styles from './repo-input.module.css';

type Props = {
  /** Currently loaded repository, used to keep the field in sync with the URL. */
  current: RepoRef | null;
  busy: boolean;
  onSubmit: (ref: RepoRef) => void;
  autoFocus?: boolean;
  size?: 'compact' | 'large';
};

export function RepoInput({ current, busy, onSubmit, autoFocus = false, size = 'compact' }: Props) {
  // `draft` is only set while the visitor is typing. The rest of the time the
  // field simply shows whatever repository is loaded, so a demo button, a shared
  // URL and the Back button all keep it in step without an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();

  const value = draft ?? current?.slug ?? '';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseRepoRef(value);
    if (!parsed.ok) {
      setError(parsed.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setDraft(null);
    onSubmit(parsed.value);
    inputRef.current?.blur();
  };

  return (
    <form
      className={`${styles.form} ${size === 'large' ? styles.large : ''}`}
      onSubmit={handleSubmit}
      role="search"
    >
      <div className={styles.field}>
        <span className={styles.prefix} aria-hidden="true">
          github.com/
        </span>
        <input
          ref={inputRef}
          id="repo-input"
          className={styles.input}
          type="text"
          name="repository"
          inputMode="url"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          placeholder="owner/repository"
          aria-label="GitHub repository, as owner/repository or a repository URL"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hintId}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(null);
              setError(null);
            }
          }}
        />
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Loading' : 'Load'}
        </button>
      </div>

      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.hint} id={hintId}>
          Public repositories only. Paste a URL or type <span className={styles.mono}>owner/repository</span>.
        </p>
      )}
    </form>
  );
}
