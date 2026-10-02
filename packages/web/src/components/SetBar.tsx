// Set bar (requirements §5.1, §5.2, §5.10; collection board, top bar). 56 px
// high with a hairline bottom rule. Left: the count as a large monospace numeral
// and the phrase, then the chips area (filter chips and "add filter"). Right:
// the search slot on pages where search applies, then the actions ("Share
// link", "Save set"). Below the drawer breakpoint a "Filters" text button
// opens the page's facet drawer when the page has registered one. Below the
// compact breakpoint the bar grows and wraps instead of scrolling sideways.
// The bar is at least 56 px high and grows when the chips wrap; below the
// drawer breakpoint the chips move to a row of their own under the count,
// search and actions.
import type { ReactNode } from 'react';
import { formatCount } from '../format';
import { DRAWER_ID, useLayout } from '../layout';
import { strings } from '../strings';

export interface SetBarProps {
  /** Genomes in the current set; undefined while pending. */
  count: number | undefined;
  chips?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
}

const toggleClass =
  'drawer:hidden rounded-control border border-control-border bg-panel px-3 py-1.75 text-control font-bold text-ink';

export function SetBar({ count, chips, search, actions }: SetBarProps) {
  const { drawerRegistered, drawerOpen, toggleDrawer, drawerToggle } = useLayout();
  return (
    <header
      aria-label={strings.setBarLabel}
      className="flex min-h-set-bar-height shrink-0 items-center gap-panel-gap border-b border-border-strong bg-background px-page-padding-x py-2 max-drawer:flex-wrap"
    >
      {drawerRegistered && (
        <button
          ref={drawerToggle}
          type="button"
          className={toggleClass}
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          onClick={toggleDrawer}
        >
          {strings.drawerToggle}
        </button>
      )}
      <div className="flex min-w-0 shrink-0 items-baseline gap-panel-gap">
        <span
          className="font-mono text-set-count font-bold tracking-tight"
          aria-live="polite"
          aria-atomic="true"
        >
          {count === undefined ? strings.valuePending : formatCount(count)}
        </span>
        <span className="mr-1.5 text-base text-text-secondary">
          {count === 1 ? strings.setBarPhraseOne : strings.setBarPhrase}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-panel-gap gap-y-2 max-drawer:order-last max-drawer:basis-full">
        {chips}
      </div>
      {(search !== undefined || actions !== undefined) && (
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-panel-gap max-compact:shrink max-compact:flex-wrap">
          {search}
          {actions}
        </div>
      )}
    </header>
  );
}
