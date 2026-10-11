import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/**
 * Below 1024px the play screen is one column that fits the screen: table, feedback strip, action bar, with
 * the decision panel in a bottom sheet (docs/mobile-plan.md). Matches the 1023px rules in styles.css.
 */
export const COMPACT_QUERY = '(max-width: 1023px)';
export const useCompact = () => useMediaQuery(COMPACT_QUERY);
