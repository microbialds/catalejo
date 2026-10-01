// Resistance class by species heatmap (requirements §6.1, §5.5, §5.6,
// §5.10; checklist C2, G12, G13; collection board, third panel). Rows are
// the chart groups (eight species and "Other"), columns the drug classes of
// the set in palette order with short labels; each cell is a button in
// chrome ink at a stepped opacity (collection/heatmap.ts) showing the integer
// percent of the row's genomes with a hit in the class, and clicking it adds
// the species and the class as filters. The panel carries the annotation
// version note when the set mixes database versions, and the §5.5 footnote
// when it mixes platforms or assembly statuses. Below the compact breakpoint
// the grid is replaced by a note that it needs a wider screen.
import type { CSSProperties } from 'react';
import {
  buildHeatmap,
  heatOpacity,
  heatPercent,
  heatStep,
  heatTextOnInk,
} from '../../collection/heatmap';
import { withSpecies } from '../../collection/species';
import type { ChartGroup } from '../../collection/species';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import { SpeciesName } from '../../components/Species';
import type { AnnotationVersionWarning } from '../../data/annotationVersions';
import type { AmrClassRow } from '../../data/setEngine';
import { AnnotationVersionNote } from '../../components/AnnotationVersionNote';
import { drugClassLabel, drugClassShortLabel } from '../../set/fields';
import { withValue } from '../../set/filters';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { PanelStatus } from './PanelStatus';

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
  const { filters, setFilters } = useGenomeSet();
  const heatmap =
    groups !== undefined && rows !== undefined ? buildHeatmap(groups, rows) : undefined;
  const wide = expansion.expanded;
  const grid: CSSProperties = {
    gridTemplateColumns: `${wide ? '200px' : '96px'} repeat(${String(
      Math.max(1, heatmap?.classes.length ?? 1),
    )}, minmax(0, 1fr))`,
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
          <div
            role="table"
            aria-label={strings.panelAmrClass}
            className="grid items-center gap-0.5 max-compact:hidden"
            style={grid}
          >
            <div role="row" className="contents">
              <span role="columnheader" />
              {heatmap.classes.map((drugClass) => (
                <span
                  key={drugClass}
                  role="columnheader"
                  title={drugClassLabel(drugClass)}
                  className={`truncate text-micro text-text-secondary ${
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
                    <SpeciesName name={row.group.label} short={!wide} className="text-base" />
                  ) : (
                    <span className="text-control">{row.group.label}</span>
                  )}
                </span>
                {row.cells.map((cell) => {
                  const step = heatStep(cell.fraction);
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
                          setFilters(
                            withValue(
                              withSpecies(filters, row.group.codes),
                              'drug_class',
                              cell.drugClass,
                            ),
                          );
                        }}
                        className={`relative flex h-6 w-full items-center justify-center overflow-hidden font-mono ${wide ? 'text-small' : 'text-small drawer:text-micro'} ${
                          step === 0 ? 'bg-bar-track' : ''
                        } ${heatTextOnInk(cell.fraction) ? 'text-on-ink' : 'text-ink'}`}
                      >
                        {step > 0 && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-0 bg-ink"
                            style={{ opacity: heatOpacity(step) }}
                          />
                        )}
                        <span className="relative">{strings.heatmapPercent(percent)}</span>
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
