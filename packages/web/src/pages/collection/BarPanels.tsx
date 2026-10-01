// Species bars and sequence types panels of the collection page
// (requirements §6.1, §5.4; checklist C2, C7, C8; collection board, first
// panel row). Each bar is a button whose accessible name states the value
// and count; clicking it adds the filter as a chip. Species bars draw the
// chart groups of collection/species.ts (the eight largest species and
// "Other"); clicking a species makes the species filter that species, and
// clicking "Other" makes it all the species in it. The ST panel draws the top
// STs of one species (collection/sequenceTypes.ts) in that species' color, or
// a statement when the species has no ST scheme.
import type { ReactNode } from 'react';
import { stPanel, stPanelSpecies, withStBar } from '../../collection/sequenceTypes';
import type { StBar } from '../../collection/sequenceTypes';
import { markStyle, withSpecies } from '../../collection/species';
import type { ChartGroup } from '../../collection/species';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import { SpeciesName } from '../../components/Species';
import type { SetSummary } from '../../data/setEngine';
import { formatCount } from '../../format';
import { palette } from '../../generated/palette';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { PanelStatus } from './PanelStatus';

function Bar({
  label,
  name,
  color,
  count,
  max,
  wide,
  onClick,
}: {
  label: ReactNode;
  name: string;
  color: string;
  count: number;
  max: number;
  wide: boolean;
  onClick: () => void;
}) {
  const width = max > 0 ? `${String((count / max) * 100)}%` : '0%';
  return (
    <li>
      <button
        type="button"
        aria-label={name}
        title={name}
        onClick={onClick}
        className={`grid w-full items-center gap-2 text-left hover:bg-background ${
          wide ? 'grid-cols-[220px_minmax(0,1fr)_56px]' : 'grid-cols-[104px_minmax(0,1fr)_40px]'
        }`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="block h-2.75 bg-bar-track">
          <span className="block h-2.75" style={{ ...markStyle(color), width }} />
        </span>
        <span className="text-right font-mono text-small">{formatCount(count)}</span>
      </button>
    </li>
  );
}

export function SpeciesPanel({
  groups,
  failed,
  expansion,
}: {
  groups: ChartGroup[] | undefined;
  failed: boolean;
  expansion: PanelExpansion;
}) {
  const { filters, setFilters } = useGenomeSet();
  const wide = expansion.expanded;
  const max = Math.max(0, ...(groups ?? []).map((group) => group.genomeCount));
  return (
    <Panel title={strings.panelSpecies} name={strings.panelSpecies} expansion={expansion}>
      {groups === undefined ? (
        <PanelStatus failed={failed} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <Bar
              key={group.key}
              label={
                group.isSpecies ? (
                  <SpeciesName name={group.label} short={!wide} className="text-base" />
                ) : (
                  <span className="text-control">{group.label}</span>
                )
              }
              name={strings.speciesBarName(group.label, formatCount(group.genomeCount))}
              color={group.color}
              count={group.genomeCount}
              max={max}
              wide={wide}
              onClick={() => {
                setFilters(withSpecies(filters, group.codes));
              }}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function stLabel(bar: StBar): string {
  return bar.isOther ? strings.stOther : strings.chipSt(bar.values[0] ?? '');
}

export function SequenceTypePanel({
  summary,
  failed,
  expansion,
}: {
  summary: SetSummary | undefined;
  failed: boolean;
  expansion: PanelExpansion;
}) {
  const { filters, setFilters } = useGenomeSet();
  const code = summary === undefined ? undefined : stPanelSpecies(filters, summary.bySpecies);
  const species = summary?.bySpecies.find((row) => row.species_code === code);
  const panel =
    summary !== undefined && code !== undefined ? stPanel(summary.bySpeciesSt, code) : undefined;
  const name =
    species === undefined
      ? strings.panelSequenceTypes
      : `${strings.panelSequenceTypes} ${species.canonical_name}`;
  const max = Math.max(0, ...(panel?.bars ?? []).map((bar) => bar.genomeCount));
  const color = species?.color ?? palette.species.other;
  return (
    <Panel
      title={
        <>
          {strings.panelSequenceTypes}
          {species !== undefined && (
            <>
              {' '}
              <span className="font-normal whitespace-nowrap text-text-secondary">
                <SpeciesName name={species.canonical_name} short={!expansion.expanded} />
              </span>
            </>
          )}
        </>
      }
      name={name}
      {...(panel !== undefined && panel.untyped > 0 && !panel.noScheme
        ? { footnote: strings.stUntyped(formatCount(panel.untyped)) }
        : {})}
      expansion={expansion}
    >
      {panel === undefined || code === undefined ? (
        <PanelStatus failed={failed} />
      ) : panel.noScheme ? (
        <p className="text-control leading-body text-text-secondary">{strings.stNoScheme}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {panel.bars.map((bar) => {
            const label = stLabel(bar);
            const count = formatCount(bar.genomeCount);
            return (
              <Bar
                key={bar.isOther ? '' : bar.values.join()}
                label={
                  <span className={bar.isOther ? 'text-control' : 'font-mono text-control'}>
                    {label}
                  </span>
                }
                name={
                  bar.isOther
                    ? strings.stOtherName(count, formatCount(bar.values.length))
                    : strings.stBarName(label, count)
                }
                color={color}
                count={bar.genomeCount}
                max={max}
                wide={false}
                onClick={() => {
                  setFilters(withStBar(filters, code, bar));
                }}
              />
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
