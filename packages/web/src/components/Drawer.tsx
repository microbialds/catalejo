// Facet rail that becomes a drawer below the drawer breakpoint (requirements
// §5.10, design token breakpoint_drawer; §9, keyboard reachable controls;
// collection board, left rail). At 1200 px and wider it is a fixed-width
// column with a hairline right border; narrower, it is hidden until the set
// bar's "Filters" toggle opens it, and then lies over the page from the left
// edge of the main area. While open, Escape closes it wherever the focus is
// and returns the focus to "Filters", and a pointer down outside both the
// drawer and "Filters" closes it (components/useDismiss.ts); a press on
// "Filters" is left to the toggle.
//
// Usage: render it as the first child of the page's row, for example
// <div className="flex"><Drawer label={strings.x}>{facets}</Drawer><div>…</div></div>,
// with no positioned ancestor between it and the shell's main element.
import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { DRAWER_ID, useLayout } from '../layout';
import { useDismiss } from './useDismiss';

export function Drawer({ label, children }: { label: string; children: ReactNode }) {
  const { drawerOpen, registerDrawer, closeDrawer, drawerToggle } = useLayout();
  useEffect(() => registerDrawer(), [registerDrawer]);
  const root = useRef<HTMLElement>(null);
  const inside = useMemo(() => [drawerToggle], [drawerToggle]);
  useDismiss(drawerOpen, { root, trigger: drawerToggle, inside, onClose: closeDrawer });
  const narrow = drawerOpen
    ? 'max-drawer:absolute max-drawer:inset-y-0 max-drawer:left-0 max-drawer:z-10 max-drawer:overflow-y-auto'
    : 'max-drawer:hidden';
  return (
    <aside
      ref={root}
      id={DRAWER_ID}
      aria-label={label}
      className={`flex w-facet-rail-width max-w-full shrink-0 flex-col border-r border-border-strong bg-background ${narrow}`}
    >
      {children}
    </aside>
  );
}
