// Held views of the panels (requirements §6.1 Controls, §9 Performance and
// Accessibility). After a filter change the collection page keeps drawing
// the previous set's charts and table until the current set's results arrive
// (pages/Collection.tsx). A panel in that state is "updating": Panel shows a
// short note beside its title and sets aria-busy, and both disappear when
// the view catches up. The state reaches a panel through PanelHeldContext,
// so that a memoized panel's body does not redraw when it flips, or through
// Panel's `updating` prop for a panel's own pending results (the table's next
// page). The note waits UPDATING_DELAY_MS before it shows, so that a fast
// update never flickers.
import { createContext, useEffect, useState } from 'react';

/** Whether the panels inside show a held view of an older set. */
export const PanelHeldContext = createContext(false);

/** How long a view is held before the panel says so. */
export const UPDATING_DELAY_MS = 150;

/** `flag`, once it has stayed true for `delay` milliseconds; false at once when it clears. */
export function useDelayedFlag(flag: boolean, delay: number): boolean {
  // The flag the current wait belongs to, and whether that wait has elapsed;
  // reset during render when the flag changes.
  const [state, setState] = useState({ flag, elapsed: false });
  if (state.flag !== flag) setState({ flag, elapsed: false });
  useEffect(() => {
    if (!flag) return;
    const timer = setTimeout(() => {
      setState({ flag: true, elapsed: true });
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [flag, delay]);
  return flag && state.flag && state.elapsed;
}
