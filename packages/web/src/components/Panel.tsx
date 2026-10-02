// Panel (requirements §7, components; §6.1 Controls; §8; collection board).
// A white box with a hairline border and 12 px 14 px padding; the title in
// the sans at 15 px bold over a light rule 6 px below it, an optional
// subtitle in secondary sans after the title, and an "expand" text control
// on the right. Slots below the body hold the annotation version note
// (§5.6) and a footnote (§5.5). Expanded, the panel spans every column of
// the grid it sits in, carries a data-expanded attribute for the page's
// layout, and shows the export menu (§8) under the title; the control then
// reads "collapse". Square corners, no shadow.
// While the panel draws a held view of an older set (components/
// panelUpdating.ts), an "Updating" note follows the title and subtitle and
// the section is aria-busy, after a short delay so fast updates never flicker.
// A panel without an expand control (the genome table on its own page,
// §5.3) may show its export menu at all times through `exportKind`.
import { useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { strings } from '../strings';
import { Button } from './Button';
import { ExportMenu } from './ExportMenu';
import type { ExportKind } from './ExportMenu';
import { PanelHeldContext, UPDATING_DELAY_MS, useDelayedFlag } from './panelUpdating';

export interface PanelExpansion {
  expanded: boolean;
  onToggle: () => void;
  /** Which export menu the expanded panel shows. */
  exportKind: ExportKind;
}

export interface PanelProps {
  /** The title as shown; may hold an italic species name. */
  title: ReactNode;
  /** The title as plain text, for accessible names. */
  name: string;
  subtitle?: ReactNode;
  expansion?: PanelExpansion;
  /** The export menu of a panel without an expand control, shown at all times. */
  exportKind?: ExportKind;
  /** The panel's own results for the current view are pending (a new table page). */
  updating?: boolean;
  /** The annotation version note (requirements §5.6). */
  note?: ReactNode;
  footnote?: ReactNode;
  className?: string;
  /** Classes of the body, which grows to fill the panel. */
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({
  title,
  name,
  subtitle,
  expansion,
  exportKind,
  updating = false,
  note,
  footnote,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const bodyId = useId();
  const held = useContext(PanelHeldContext);
  const busy = useDelayedFlag(held || updating, UPDATING_DELAY_MS);
  const expanded = expansion?.expanded === true;
  const exportMenu = expansion?.expanded === true ? expansion.exportKind : exportKind;
  const classes = [
    'flex min-w-0 flex-col gap-2 border border-border bg-panel px-panel-padding-x py-panel-padding-y',
    expanded ? 'col-span-full' : '',
    className ?? '',
  ]
    .filter((part) => part !== '')
    .join(' ');
  return (
    <section
      aria-label={name}
      className={classes}
      {...(expanded ? { 'data-expanded': '' } : {})}
      {...(busy ? { 'aria-busy': true } : {})}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-rule-light pb-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <h2 className="min-w-0 font-sans text-panel-title font-bold">
            {title}
            {subtitle !== undefined && (
              <span className="ml-1.5 font-sans text-control font-regular text-text-secondary">
                {subtitle}
              </span>
            )}
          </h2>
          {busy && (
            <span className="font-sans text-control whitespace-nowrap text-text-secondary">
              {strings.panelUpdating}
            </span>
          )}
        </div>
        {expansion !== undefined && (
          <Button
            variant="link"
            className="shrink-0 text-small"
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={expanded ? strings.panelCollapseName(name) : strings.panelExpandName(name)}
            onClick={expansion.onToggle}
          >
            {expanded ? strings.panelCollapse : strings.panelExpand}
          </Button>
        )}
      </div>
      {exportMenu !== undefined && <ExportMenu kind={exportMenu} />}
      <div id={bodyId} className={`flex min-w-0 grow flex-col ${bodyClassName ?? ''}`}>
        {children}
      </div>
      {note}
      {footnote !== undefined && (
        <p className="text-small leading-body text-text-secondary">{footnote}</p>
      )}
    </section>
  );
}
