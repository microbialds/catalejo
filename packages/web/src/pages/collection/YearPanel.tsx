// Genomes by year, stacked by species (requirements §6.1; checklist C2;
// collection board, second panel row). One column per isolation year, gaps
// included, stacked by the chart groups in rank order from the bottom, in
// the species colors and gray for "Other" (the yellow with its ink outline).
// Every segment and every year label is a button: a year label sets the
// year filter to that year ({min: y, max: y}); a segment also sets the
// species filter to the segment's species, "Other" to the species it holds
// (collection/years.ts withYear, withYearSegment). Genomes without an
// isolation date are not drawn; the subtitle states how many.
import { buildYearChart, withYear, withYearSegment, yearLabelStep } from '../../collection/years';
import { markStyle } from '../../collection/species';
import type { ChartGroup } from '../../collection/species';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import type { SpeciesYearRow } from '../../data/setEngine';
import { formatCount } from '../../format';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { PanelStatus } from './PanelStatus';

const MAX_LABELS = 12;

export function YearPanel({
  groups,
  rows,
  failed,
  expansion,
}: {
  groups: ChartGroup[] | undefined;
  rows: SpeciesYearRow[] | undefined;
  failed: boolean;
  expansion: PanelExpansion;
}) {
  const { updateFilters } = useGenomeSet();
  const chart =
    groups !== undefined && rows !== undefined ? buildYearChart(groups, rows) : undefined;
  const pick = (year: number) => {
    updateFilters((current) => withYear(current, year));
  };
  const step = yearLabelStep(chart?.columns.length ?? 0, MAX_LABELS);
  const subtitle =
    chart !== undefined && chart.undated > 0
      ? `${strings.panelYearSubtitle}${strings.separator}${strings.yearUndated(formatCount(chart.undated))}`
      : strings.panelYearSubtitle;
  return (
    <Panel
      title={strings.panelYear}
      name={strings.panelYear}
      subtitle={subtitle}
      expansion={expansion}
    >
      {chart === undefined ? (
        <PanelStatus failed={failed} />
      ) : chart.columns.length === 0 ? (
        <p className="text-control text-text-secondary">{strings.yearNoDates}</p>
      ) : (
        <div className="flex flex-col">
          <ul
            aria-label={strings.panelYear}
            className={`flex items-end gap-1 border-b border-ink ${expansion.expanded ? 'h-60' : 'h-19'}`}
          >
            {chart.columns.map((column) => (
              <li key={column.year} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                {column.segments.map((segment) => {
                  const name = strings.yearSegmentName(
                    segment.group.label,
                    column.year,
                    formatCount(segment.genomeCount),
                    segment.genomeCount,
                  );
                  return (
                    <button
                      key={segment.group.key}
                      type="button"
                      aria-label={name}
                      title={name}
                      onClick={() => {
                        updateFilters((current) =>
                          withYearSegment(current, segment.group.codes, column.year),
                        );
                      }}
                      className="block w-full shrink-0"
                      style={{
                        height: `${String((segment.genomeCount / chart.maxTotal) * 100)}%`,
                      }}
                    >
                      {/* The fill and its outline sit inside, so the focus ring stays visible. */}
                      <span
                        aria-hidden="true"
                        className="block h-full w-full"
                        style={markStyle(segment.group.color)}
                      />
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
          <div className="flex gap-1 pt-0.5">
            {chart.columns.map((column, index) => (
              <span key={column.year} className="flex min-w-0 flex-1 justify-center">
                {index % step === 0 && column.total === 0 && (
                  <span className="font-mono text-micro text-text-label">{column.year}</span>
                )}
                {index % step === 0 && column.total > 0 && (
                  <button
                    type="button"
                    aria-label={strings.yearColumnName(
                      column.year,
                      formatCount(column.total),
                      column.total,
                    )}
                    onClick={() => {
                      pick(column.year);
                    }}
                    className="font-mono text-micro text-text-secondary hover:text-ink"
                  >
                    {column.year}
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
