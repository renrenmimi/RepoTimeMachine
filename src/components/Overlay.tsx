'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import styles from './overlay.module.css';

type Props = {
  /** Heading text, used as the dialog's accessible name. */
  title: string;
  /** `dialog` centres; `drawer` slides in from the leading edge. */
  variant?: 'dialog' | 'drawer';
  onClose: () => void;
  children: React.ReactNode;
};

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A modal surface: the shared behaviour every dialog and drawer owes its user.
 *
 * Escape closes, Tab cycles inside, the page behind cannot scroll, and focus
 * returns to whatever opened it. Written once because getting three of the four
 * right is the usual outcome of writing it four times.
 */
export function Overlay({ title, variant = 'dialog', onClose, children }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    /*
     * Whatever had focus when this mounted is what focus goes back to. Read
     * here rather than during render: nothing inside the overlay is focused
     * yet, so the active element is still the trigger.
     */
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Stop here: the application's own shortcuts must not also fire.
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const edge = event.shiftKey ? focusable[0]! : focusable[focusable.length - 1]!;
      if (document.activeElement === edge || !surface.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1]! : focusable[0]!).focus();
      }
    };

    /*
     * The page keeps its scroll position: `overflow: hidden` alone would let the
     * document jump to the top and then jump back when the overlay closes.
     *
     * Captured *before* anything inside the overlay is focused. Focusing an
     * element scrolls it into view, and the overlay's own first control is
     * pinned to the top of the viewport — so focusing first meant reading a
     * scroll position of 0 and losing wherever the visitor actually was.
     */
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    // The first control, or the surface itself when it holds only text. Without
    // `preventScroll` this is the call that used to move the page.
    const first = surface.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? surface).focus({ preventScroll: true });

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;

      /*
       * Restoring the position takes two deliberate steps.
       *
       * While the overlay was open the body was `position: fixed`, so the
       * document was only as tall as the viewport. Scrolling immediately after
       * putting the styles back asks the browser to scroll a document it has not
       * re-measured yet, and it clamps to whatever fits — which sent a page
       * scrolled to 900px back to 0. Reading a layout property forces the
       * measurement first.
       *
       * And focusing an element scrolls it into view, so the trigger is given
       * the focus without the scrolling; returning focus is what makes the
       * keyboard path a loop rather than a one-way trip into the document.
       */
      void document.documentElement.scrollHeight;
      window.scrollTo(0, scrollY);
      opener?.focus?.({ preventScroll: true });
    };
  }, [close]);

  return (
    <div className={styles.scrim} data-variant={variant}>
      {/* A click on the backdrop is a deliberate dismissal; the surface stops
          its own clicks from reaching it. */}
      <button type="button" className={styles.backdrop} aria-label={`Close ${title}`} onClick={close} />
      <div
        ref={surfaceRef}
        className={styles.surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={close}>
            Close
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
