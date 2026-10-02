// Shell layout state for the viewport policy (requirements §5.10). Below the
// drawer breakpoint (1200 px) a page's facet rail becomes a drawer opened from
// the set bar; the page registers it by rendering components/Drawer.tsx, and
// the set bar shows the toggle only while a drawer is registered, holding it
// in `drawerToggle` so that the drawer can return the focus to it on Escape.
// The drawer closes when the path changes.
import { createContext, useContext } from 'react';
import type { RefObject } from 'react';

/** Element id of the registered drawer, for aria-controls on the toggle. */
export const DRAWER_ID = 'page-drawer';

export interface LayoutState {
  /** Whether the current page has registered a drawer. */
  drawerRegistered: boolean;
  /** Whether the drawer is open (only meaningful below the drawer breakpoint). */
  drawerOpen: boolean;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  /** Registers a drawer; returns the function that unregisters it. */
  registerDrawer: () => () => void;
  /** The set bar's "Filters" toggle. */
  drawerToggle: RefObject<HTMLButtonElement | null>;
}

const inert: LayoutState = {
  drawerRegistered: false,
  drawerOpen: false,
  toggleDrawer: () => undefined,
  closeDrawer: () => undefined,
  registerDrawer: () => () => undefined,
  drawerToggle: { current: null },
};

export const LayoutContext = createContext<LayoutState>(inert);

export function useLayout(): LayoutState {
  return useContext(LayoutContext);
}
