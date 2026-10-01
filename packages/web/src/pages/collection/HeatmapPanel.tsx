// Resistance class by species heatmap (requirements §6.1, §5.5, §5.6,
// §5.10; checklist C2, G12, G13; collection board, third panel). Rows are
// the chart groups (eight species and "Other"), columns the drug classes of
// the set in palette order with short labels; each cell is a button with a
// solid fill from the sequential heatmap scale (collection/heatmap.ts; zero
// stays on the panel white) showing the integer
// percent of the row's genomes with a hit in the class, and clicking it adds
// the species and the class as filters. The panel carries the annotation
// version note when the set mixes database versions, and the §5.5 footnote
// when it mixes platforms or assembly statuses. Below the compact breakpoint
// the grid is replaced by a note that it needs a wider screen. A species
// row header links to the collection filtered by that species (§5.9), in the
// quiet link tier of tables (§5.4).
// A cell column is never narrower than its widest value ("100", three
// monospace digits at the cell size, sized in ch on the grid so it holds for
// any fallback face); when the panel is narrower than that, the grid scrolls
// sideways inside the panel instead of letting values spill into each other.
// Columns are a hairline apart, so that eleven classes in B612 Mono fit the
// panel at the 1440 px board width without scrolling.
import type { CSSProperties } from 'react';
import {
  buildHeatmap,
  heatFill,
  heatPercent,
  heatStep,
  heatTextOnInk,
} from '../../collection/heatmap';
import { withSpecies } from '../../collection/species';
import type { ChartGroup } from '../../collection/species';
import { Link } from '../../components/Link';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import { SpeciesName } from '../../components/Species';
import type { AnnotationVersionWarning } from '../../data/annotationVersions';
import type { AmrClassRow } from '../../data/setEngine';
import { AnnotationVersionNote } from '../../components/AnnotationVersionNote';
import { QUIET_LINK } from '../../linkTier';
import { drugClassLabel, drugClassShortLabel } from '../../set/fields';
import { withValue } from '../../set/filters';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { PanelStatus } from './PanelStatus';

/** The narrowest cell column: "100" at the cell size, plus one pixel of air. */
const CELL_MIN_WIDTH = 'calc(3ch + 1px)';

export function HeatmapPanel({
  groups,
  rows,
  failed,
  warning,
  mixed,
  expansion,
}: {
  groups: ChartGroup[] | undefined;
  rows: AmrClassRow[] | undefined;
  failed: boolean;
  warning: AnnotationVersionWarning | null;
  mixed: boolean;
  expansion: PanelExpansion;
}) {
  const { updateFilters, queryFor } = useGenomeSet();
  const heatmap =
    groups !== undefined && rows !== undefined ? buildHeatmap(groups, rows) : undefined;
  const wide = expansion.expanded;
  const grid: CSSProperties = {
    gridTemplateColumns: `${wide ? '200px' : '96px'} repeat(${String(
      Math.max(1, heatmap?.classes.length ?? 1),
    )}, minmax(${CELL_MIN_WIDTH}, 1fr))`,
  };
  return (
    <Panel
      title={strings.panelAmrClass}
      name={strings.panelAmrClass}
      subtitle={strings.panelAmrClassUnit}
      expansion={expansion}
      note={<AnnotationVersionNote warning={warning} />}
      {...(mixed ? { footnote: strings.footnoteMixedAssemblies } : {})}
    >
      {heatmap === undefined ? (
        <PanelStatus failed={failed} />
      ) : heatmap.classes.length === 0 ? (
        <p className="text-control text-text-secondary">{strings.heatmapNoHits}</p>
      ) : (
        <>
          <p className="text-control text-text-secondary compact:hidden">
            {strings.heatmapNeedsWidth}
          </p>
          <div className="min-w-0 overflow-x-auto">
            <div
              role="table"
              aria-label={strings.panelAmrClass}
              className={`grid items-center gap-x-px gap-y-0.5 font-mono max-compact:hidden ${wide ? 'text-small' : 'text-small drawer:text-micro'}`}
              style={grid}
            >
              <div role="row" className="contents">
                <span role="columnheader" />
                {heatmap.classes.map((drugClass) => (
                  <span
                    key={drugClass}
                    role="columnheader"
                    title={drugClassLabel(drugClass)}
                    className={`truncate font-sans text-micro text-text-secondary ${
                      wide
                        ? 'text-center'
                        : 'max-h-16 justify-self-center text-left drawer:rotate-180 drawer:[writing-mode:vertical-rl]'
                    }`}
                  >
                    {wide ? drugClassLabel(drugClass) : drugClassShortLabel(drugClass)}
                  </span>
                ))}
              </div>
              {heatmap.rows.map((row) => (
                <div key={row.group.key} role="row" className="contents">
                  <span role="rowheader" className="min-w-0 truncate">
                    {row.group.isSpecies ? (
                      <Link
                        to="/"
                        query={queryFor({ species_code: row.group.codes })}
                        className={QUIET_LINK}
                      >
                        <SpeciesName name={row.group.label} short={!wide} className="text-base" />
                      </Link>
                    ) : (
                      <span className="font-sans text-control">{row.group.label}</span>
                    )}
                  </span>
                  {row.cells.map((cell) => {
                    const step = heatStep(cell.fraction);
                    const fill = heatFill(step);
                    const percent = String(heatPercent(cell.fraction));
                    const name = strings.heatmapCellName(
                      row.group.label,
                      drugClassLabel(cell.drugClass),
                      percent,
                    );
                    return (
                      <span key={cell.drugClass} role="cell" className="min-w-0">
                        <button
                          type="button"
                          aria-label={name}
                          title={name}
                          onClick={() => {
                            updateFilters((current) =>
                              withValue(
                                withSpecies(current, row.group.codes),
                                'drug_class',
                                cell.drugClass,
                              ),
                            );
                          }}
                          className={`flex h-6 w-full items-center justify-center overflow-hidden ${
                            heatTextOnInk(step) ? 'text-on-ink' : 'text-ink'
                          }`}
                          {...(fill === undefined ? {} : { style: { backgroundColor: fill } })}
                        >
                          {strings.heatmapPercent(percent)}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
