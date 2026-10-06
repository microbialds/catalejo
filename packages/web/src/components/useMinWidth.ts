// Whether the viewport is at least a breakpoint wide (requirements §5.10), for
// the parts of the shell that change structure and not only style at a
// breakpoint: the set bar's "Set" control and the place of the search field
// (§5.1). The breakpoints come from the design tokens, the same values as the
// stylesheet's compact: and drawer: variants. Where the browser has no
// matchMedia (the component tests), the viewport counts as wide.
import { useCallback, useSyncExternalStore } from 'react';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMinWidth(width: string): boolean {
  const query = `(min-width: ${width})`;
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!hasMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => {
        list.removeEventListener('change', notify);
      };
    },
    [query],
  );
  const snapshot = useCallback(() => !hasMatchMedia() || window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
