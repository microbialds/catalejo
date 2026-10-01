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
//
// The facet rail and the counters update first after a filter change (§6.1,
// §9; checklist C4). The charts and the genome table draw a view, the store
// and the summary of the last set whose summary has settled, which follows
// the current set at deferred priority; the panels are memoized. So the click
// renders the rail and the set bar only, the set's queries run without the
// charts and the table redrawing in between, and the counts reach the rail in
// an urgent render before the charts and the table follow.
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { mixesAssemblies } from '../collection/facets';
import { speciesGroups } from '../collection/species';
import { CounterStrip } from '../components/CounterStrip';
import type { Counter } from '../components/CounterStrip';
import { Drawer } from '../components/Drawer';
import type { PanelExpansion } from '../components/Panel';
import type { ExportKind } from '../components/ExportMenu';
import { annotationVersionWarning } from '../data/annotationVersions';
import { useManifest } from '../data/manifest';
import type { Manifest } from '../data/manifest';
import { countersOf } from '../data/setEngine';
import type { SetSummary } from '../data/setEngine';
import { SetView, useGenomeSet } from '../set/store';
import type { GenomeSetStore } from '../set/store';
import { strings } from '../strings';
import * as bars from './collection/BarPanels';
import { useCollectionData, useQcPoints } from './collection/data';
import * as facets from './collection/Facets';
import * as table from './collection/GenomeTablePanel';
import * as heatmap from './collection/HeatmapPanel';
import * as qcPanel from './collection/QcPanel';
import * as year from './collection/YearPanel';

export type CollectionPanelId = 'species' | 'st' | 'heatmap' | 'year' | 'qc' | 'table';

// A panel re-renders only when its own props or the store change.
const SpeciesPanel = memo(bars.SpeciesPanel);
const SequenceTypePanel = memo(bars.SequenceTypePanel);
const HeatmapPanel = memo(heatmap.HeatmapPanel);
const YearPanel = memo(year.YearPanel);
const QcPanel = memo(qcPanel.QcPanel);
const GenomeTablePanel = memo(table.GenomeTablePanel);
const Facets = memo(facets.Facets);

const PANEL_IDS: readonly CollectionPanelId[] = ['species', 'st', 'heatmap', 'year', 'qc', 'table'];

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

/** The species of a summary that have genomes in the set. */
function speciesIn(summary: SetSummary): string[] {
  return summary.bySpecies.filter((row) => row.genome_count > 0).map((row) => row.species_code);
}

function warningOf(manifest: Manifest | undefined, summary: SetSummary | undefined) {
  return manifest === undefined || summary === undefined
    ? null
    : annotationVersionWarning(manifest, speciesIn(summary));
}

/** What the charts and the table draw: a store and the summary of its set. */
interface View {
  store: GenomeSetStore;
  summary: SetSummary | undefined;
}

export function Collection() {
  const manifest = useManifest();
  const store = useGenomeSet();
  const { filters } = store;
  const { summary, release, mobile } = useCollectionData(filters);
  const [expanded, setExpanded] = useState<CollectionPanelId | null>(null);

  // One stable expansion object per panel, so that memoized panels skip renders.
  const expansions = useMemo(() => {
    const make = (id: CollectionPanelId): PanelExpansion => {
      const exportKind: ExportKind = id === 'table' ? 'table' : 'figure';
      return {
        expanded: expanded === id,
        onToggle: () => {
          setExpanded((current) => (current === id ? null : id));
        },
        exportKind,
      };
    };
    return Object.fromEntries(PANEL_IDS.map((id) => [id, make(id)])) as Record<
      CollectionPanelId,
      PanelExpansion
    >;
  }, [expanded]);

  const value = summary.value;
  // The view moves to the current set once its summary has settled (derived
  // state), and the charts and the table follow it at deferred priority.
  const [held, setHeld] = useState<View>({ store, summary: value });
  if (!summary.pending && (held.store !== store || held.summary !== value)) {
    setHeld({ store, summary: value });
  }
  const view = useDeferredValue(held);
  // A newer set is loading while the view still moves to an older one: the
  // view stays where it is, and that redraw is skipped (C4).
  if (summary.pending && view !== held) setHeld(view);
  const chartValue = view.summary;
  const qc = useQcPoints(view.store.filters);
  const chartGroups = useMemo(
    () => (chartValue === undefined ? undefined : speciesGroups(chartValue.bySpecies)),
    [chartValue],
  );
  const chartWarning = useMemo(() => warningOf(manifest, chartValue), [manifest, chartValue]);
  const chartMixed = chartValue !== undefined && mixesAssemblies(chartValue);

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
  const warning = useMemo(() => warningOf(manifest, value), [manifest, value]);

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
        <SetView store={view.store}>
          <div
            className={rowClass(
              TOP_ROW,
              expanded,
              'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]',
            )}
          >
            <SpeciesPanel
              groups={chartGroups}
              failed={summary.failed}
              expansion={expansions.species}
            />
            <SequenceTypePanel
              summary={chartValue}
              failed={summary.failed}
              expansion={expansions.st}
            />
            <HeatmapPanel
              groups={chartGroups}
              rows={chartValue?.amrClassBySpecies}
              failed={summary.failed}
              warning={chartWarning}
              mixed={chartMixed}
              expansion={expansions.heatmap}
            />
          </div>
          <div
            className={rowClass(SECOND_ROW, expanded, 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}
          >
            <YearPanel
              groups={chartGroups}
              rows={chartValue?.bySpeciesYear}
              failed={summary.failed}
              expansion={expansions.year}
            />
            <QcPanel points={qc.value} failed={qc.failed} expansion={expansions.qc} />
          </div>
          <GenomeTablePanel expansion={expansions.table} />
        </SetView>
      </div>
    </div>
  );
}
