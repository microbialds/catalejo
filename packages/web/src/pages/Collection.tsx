// Collection page (requirements §6.1, §5.4 to §5.6, §5.9, §5.10, §7, §8;
// data contract §6.2; checklist C1 to C8; collection board). The facet rail
// (232 px, a drawer below 1200 px) beside the main area: the counter strip
// (genomes, species, sequence types, resistance determinant hits, plasmid
// contigs), a row of three panels (species bars, sequence types of the
// selected or largest species, resistance class by species heatmap), a row
// of two (genomes by year stacked by species, assembly QC scatter), and the
// genome table. Panel rows stack below 1200 px; below 900 px the heatmap
// gives way to a note (§5.10). Every panel expands to the full width of its
// row with the export menu (§6.1): it moves to the top of its row group, and
// the other panels of the group share the row below it in equal columns, so
// none is squeezed beside it. An empty set never reaches this page: the shell
// shows the empty-set message instead (§5.2).
import { useState } from 'react';
import { mixesAssemblies } from '../collection/facets';
import { speciesGroups } from '../collection/species';
import { CounterStrip } from '../components/CounterStrip';
import type { Counter } from '../components/CounterStrip';
import { Drawer } from '../components/Drawer';
import type { PanelExpansion } from '../components/Panel';
import type { ExportKind } from '../components/ExportMenu';
import { annotationVersionWarning } from '../data/annotationVersions';
import { useManifest } from '../data/manifest';
import { countersOf } from '../data/setEngine';
import { useGenomeSet } from '../set/store';
import { strings } from '../strings';
import { SequenceTypePanel, SpeciesPanel } from './collection/BarPanels';
import { useCollectionData } from './collection/data';
import { Facets } from './collection/Facets';
import { GenomeTablePanel } from './collection/GenomeTablePanel';
import { HeatmapPanel } from './collection/HeatmapPanel';
import { QcPanel } from './collection/QcPanel';
import { YearPanel } from './collection/YearPanel';

export type CollectionPanelId = 'species' | 'st' | 'heatmap' | 'year' | 'qc' | 'table';

const TOP_ROW: readonly CollectionPanelId[] = ['species', 'st', 'heatmap'];
const SECOND_ROW: readonly CollectionPanelId[] = ['year', 'qc'];

// The expanded panel comes first in its row group (Panel marks it).
const rowBase = 'grid gap-panel-gap max-drawer:grid-cols-1 *:data-expanded:order-first';

/** The columns of a panel row: the board's at rest, the rest in equal columns below an expanded panel. */
function rowClass(
  ids: readonly CollectionPanelId[],
  expanded: CollectionPanelId | null,
  columns: string,
): string {
  if (expanded === null || !ids.includes(expanded)) return `${rowBase} ${columns}`;
  return ids.length - 1 > 1 ? `${rowBase} grid-cols-2` : `${rowBase} grid-cols-1`;
}

export function Collection() {
  const manifest = useManifest();
  const { filters } = useGenomeSet();
  const { summary, release, mobile, qc } = useCollectionData(filters);
  const [expanded, setExpanded] = useState<CollectionPanelId | null>(null);

  const expansion = (id: CollectionPanelId, exportKind: ExportKind = 'figure'): PanelExpansion => ({
    expanded: expanded === id,
    onToggle: () => {
      setExpanded(expanded === id ? null : id);
    },
    exportKind,
  });

  const value = summary.value;
  const totals = value === undefined ? undefined : countersOf(value.bySpecies);
  const counters: Counter[] = [
    {
      key: 'genomes',
      label: strings.counterGenomes,
      labelOne: strings.counterGenomesOne,
      value: totals?.genomes,
    },
    { key: 'species', label: strings.counterSpecies, value: totals?.species },
    {
      key: 'sts',
      label: strings.counterSequenceTypes,
      labelOne: strings.counterSequenceTypesOne,
      value: totals?.sequenceTypes,
    },
    {
      key: 'amr',
      label: strings.counterAmrHits,
      labelOne: strings.counterAmrHitsOne,
      value: totals?.amrHits,
    },
    {
      key: 'plasmids',
      label: strings.counterPlasmidContigs,
      labelOne: strings.counterPlasmidContigsOne,
      value: totals?.plasmidContigs,
    },
  ];
  const groups = value === undefined ? undefined : speciesGroups(value.bySpecies);
  const speciesInSet = (value?.bySpecies ?? [])
    .filter((row) => row.genome_count > 0)
    .map((row) => row.species_code);
  const warning =
    manifest === undefined || value === undefined
      ? null
      : annotationVersionWarning(manifest, speciesInSet);

  return (
    <div className="flex min-w-0 grow">
      <Drawer label={strings.facetsLabel}>
        <Facets
          release={release.value}
          summary={value}
          mobile={mobile.value}
          pending={summary.pending}
          warning={warning}
        />
      </Drawer>
      <div className="flex min-w-0 grow flex-col gap-panel-gap px-page-padding-x py-page-padding-y">
        <h1 className="sr-only">{strings.pageCollection}</h1>
        <CounterStrip label={strings.countersLabel} counters={counters} />
        <div
          className={rowClass(
            TOP_ROW,
            expanded,
            'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]',
          )}
        >
          <SpeciesPanel groups={groups} failed={summary.failed} expansion={expansion('species')} />
          <SequenceTypePanel summary={value} failed={summary.failed} expansion={expansion('st')} />
          <HeatmapPanel
            groups={groups}
            rows={value?.amrClassBySpecies}
            failed={summary.failed}
            warning={warning}
            mixed={value !== undefined && mixesAssemblies(value)}
            expansion={expansion('heatmap')}
          />
        </div>
        <div
          className={rowClass(SECOND_ROW, expanded, 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}
        >
          <YearPanel
            groups={groups}
            rows={value?.bySpeciesYear}
            failed={summary.failed}
            expansion={expansion('year')}
          />
          <QcPanel points={qc.value} failed={qc.failed} expansion={expansion('qc')} />
        </div>
        <GenomeTablePanel expansion={expansion('table', 'table')} />
      </div>
    </div>
  );
}
