// Set bar (requirements §5.1, §5.2, §5.10; collection board, top bar). Exactly
// the set_bar_height token (56 px) high at every width, one line, with a
// hairline bottom rule. Left: the count as a large monospace numeral and the
// phrase, then the chips row, which shows the chips that fit and "+N more"
// for the others (components/FilterChips.tsx), then the inline controls
// ("+ add filter", "complete genomes only") where the shell places them in
// the bar. Right: the search slot, then the actions ("Share link", "Save
// set"), or the "Set" control that groups them with the inline controls at
// narrow widths (components/SetActions.tsx). Below the drawer breakpoint a
// "Filters" text button opens the page's facet drawer when the page has
// registered one. Below the compact breakpoint the gaps and the toggles'
// padding tighten and the phrase takes two lines, so that the count, the
// phrase, "Filters", the chips row and "Set" share the one line.
import type { ReactNode } from 'react';
import { formatCount } from '../format';
import { DRAWER_ID, useLayout } from '../layout';
import { strings } from '../strings';
import { barToggleClass } from './SetActions';

export interface SetBarProps {
  /** Genomes in the current set; undefined while pending. */
  count: number | undefined;
  /** The chips row; it takes the free width of the line. */
  chips?: ReactNode;
  /** Controls after the chips row ("+ add filter", the complete toggle). */
  inline?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
}

export function SetBar({ count, chips, inline, search, actions }: SetBarProps) {
  const { drawerRegistered, drawerOpen, toggleDrawer, drawerToggle } = useLayout();
  return (
    <header
      aria-label={strings.setBarLabel}
      className="relative flex h-set-bar-height shrink-0 flex-nowrap items-center gap-panel-gap border-b border-border-strong bg-background px-page-padding-x max-compact:gap-2"
    >
      {drawerRegistered && (
        <button
          ref={drawerToggle}
          type="button"
          className={`drawer:hidden ${barToggleClass}`}
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          onClick={toggleDrawer}
        >
          {strings.drawerToggle}
        </button>
      )}
      <div className="flex shrink-0 items-baseline gap-panel-gap max-compact:items-center max-compact:gap-2">
        <span
          className="font-mono text-set-count font-bold tracking-tight"
          aria-live="polite"
          aria-atomic="true"
        >
          {count === undefined ? strings.valuePending : formatCount(count)}
        </span>
        <span className="mr-1.5 text-base whitespace-nowrap text-text-secondary max-compact:mr-0 max-compact:max-w-28 max-compact:leading-tight max-compact:whitespace-normal">
          {count === 1 ? strings.setBarPhraseOne : strings.setBarPhrase}
        </span>
      </div>
      {chips}
      {inline !== undefined && (
        <div className="flex shrink-0 items-center gap-panel-gap whitespace-nowrap">{inline}</div>
      )}
      {(search !== undefined || actions !== undefined) && (
        <div className="flex min-w-0 shrink items-center gap-panel-gap max-compact:shrink-0">
          {search}
          {actions}
        </div>
      )}
    </header>
  );
}
