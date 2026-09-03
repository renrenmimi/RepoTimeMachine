'use client';

import { useId, useRef, useState } from 'react';
import { parseRepoRef, type RepoRef } from '@/lib/repo-ref';
import styles from './repo-input.module.css';

type Props = {
  /** Currently loaded repository, used to keep the field in sync with the URL. */
  current: RepoRef | null;
  busy: boolean;
  onSubmit: (ref: RepoRef) => void;
  /** Offered where there is something to go back to; omitted on the home screen. */
  onCancel?: () => void;
  autoFocus?: boolean;
  /** `primary` fills the submit button — used where this is the main action. */
  emphasis?: 'primary' | 'secondary';
};

export function RepoInput({
  current,
  busy,
  onSubmit,
  onCancel,
  autoFocus = false,
  emphasis = 'secondary',
}: Props) {
  // `draft` is only set while the visitor is typing. The rest of the time the
  // field simply shows whatever repository is loaded, so a demo button, a shared
  // URL and the Back button all keep it in step without an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();
  const fieldId = useId();

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

  /** Abandoning an edit leaves the loaded repository exactly as it was. */
  const cancel = () => {
    setDraft(null);
    setError(null);
    onCancel?.();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor={fieldId}>
        Open a public repository
      </label>

      <div className={styles.row}>
        <input
          ref={inputRef}
          id={fieldId}
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hintId}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancel();
            }
          }}
        />
        <button
          className={emphasis === 'primary' ? styles.submitPrimary : styles.submit}
          type="submit"
          disabled={busy}
        >
          {busy ? 'Loading…' : 'Load repository'}
        </button>
        {onCancel ? (
          <button className={styles.cancel} type="button" onClick={cancel}>
            Cancel
          </button>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : (
        /* Only what you must know to use the field. The rest is in How it works. */
        <p className={styles.hint} id={hintId}>
          Public repositories only, on the default branch. Paste a GitHub URL or type{' '}
          <span className={styles.mono}>owner/repository</span>.
        </p>
      )}
    </form>
  );
}
