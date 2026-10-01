// Set bar (requirements §5.1, §5.2, §5.10; collection board, top bar). 56 px
// high with a hairline bottom rule. Left: the count as a large serif numeral
// and the phrase, then the chips area (filter chips and "add filter"). Right:
// the search slot on pages where search applies, then the actions ("Share
// link", "Save set"). Below the drawer breakpoint a "Filters" text button
// opens the page's facet drawer when the page has registered one. Below the
// compact breakpoint the bar grows and wraps instead of scrolling sideways.
// The chips, search and actions arrive with the genome-set store.
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
  'drawer:hidden rounded-control border border-control-border bg-panel px-3 py-1.75 text-control font-medium text-ink';

export function SetBar({ count, chips, search, actions }: SetBarProps) {
  const { drawerRegistered, drawerOpen, toggleDrawer } = useLayout();
  return (
    <header
      aria-label={strings.setBarLabel}
      className="flex h-set-bar-height shrink-0 items-center gap-panel-gap border-b border-border-strong bg-background px-page-padding-x max-compact:h-auto max-compact:min-h-set-bar-height max-compact:flex-wrap max-compact:py-2"
    >
      {drawerRegistered && (
        <button
          type="button"
          className={toggleClass}
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          onClick={toggleDrawer}
        >
          {strings.drawerToggle}
        </button>
      )}
      <div className="flex min-w-0 items-baseline gap-panel-gap">
        <span className="font-serif text-set-count font-semibold tracking-tight">
          {count === undefined ? strings.valuePending : formatCount(count)}
        </span>
        <span className="text-base text-text-secondary">{strings.setBarPhrase}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{chips}</div>
      <div className="grow max-compact:hidden" />
      {(search !== undefined || actions !== undefined) && (
        <div className="flex min-w-0 flex-wrap items-center gap-panel-gap">
          {search}
          {actions}
        </div>
      )}
    </header>
  );
}
