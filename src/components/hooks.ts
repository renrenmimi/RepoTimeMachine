'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * `prefers-reduced-motion`, read as state so JavaScript-driven effects (change
 * pulses, smooth scrolling) can be skipped, not just CSS transitions.
 */
export function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
    () => false,
  );
}

/** Media query as boolean state. Server snapshot is always false. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Debounced mirror of a value, used to avoid refetching on every keystroke. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export type VirtualWindow = {
  start: number;
  end: number;
  paddingTop: number;
  totalHeight: number;
};

/**
 * Fixed-height row virtualisation.
 *
 * Large repositories have thousands of paths and long histories have thousands
 * of commits; rendering them all would cost far more than the data itself.
 */
export function useVirtualRows(
  containerRef: React.RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan = 8,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      // One state update per frame keeps scrolling off the critical path.
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(element.scrollTop);
      });
    };

    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    setViewport(element.clientHeight);
    setScrollTop(element.scrollTop);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [containerRef]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
  const end = Math.min(rowCount, start + visible);

  return {
    start,
    end,
    paddingTop: start * rowHeight,
    totalHeight: rowCount * rowHeight,
  };
}
