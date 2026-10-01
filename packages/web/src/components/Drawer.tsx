// Facet rail that becomes a drawer below the drawer breakpoint (requirements
// §5.10, design token breakpoint_drawer; collection board, left rail). At
// 1200 px and wider it is a fixed-width column with a hairline right border;
// narrower, it is hidden until the set bar's toggle opens it, and then lies
// over the page from the left edge of the main area. Escape closes it.
//
// Usage: render it as the first child of the page's row, for example
// <div className="flex"><Drawer label={strings.x}>{facets}</Drawer><div>…</div></div>,
// with no positioned ancestor between it and the shell's main element.
import { useEffect } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { DRAWER_ID, useLayout } from '../layout';

export function Drawer({ label, children }: { label: string; children: ReactNode }) {
  const { drawerOpen, registerDrawer, closeDrawer } = useLayout();
  useEffect(() => registerDrawer(), [registerDrawer]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && drawerOpen) {
      event.stopPropagation();
      closeDrawer();
    }
  };
  const narrow = drawerOpen
    ? 'max-drawer:absolute max-drawer:inset-y-0 max-drawer:left-0 max-drawer:z-10 max-drawer:overflow-y-auto'
    : 'max-drawer:hidden';
  return (
    <aside
      id={DRAWER_ID}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex w-facet-rail-width max-w-full shrink-0 flex-col border-r border-border-strong bg-background ${narrow}`}
    >
      {children}
    </aside>
  );
}
