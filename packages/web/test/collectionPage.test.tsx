// @vitest-environment jsdom
// Requirements §6.1, §5.5, §5.6, §5.9, §8 and checklist C1, C2, C3, C5, C6,
// C8, G13 on the collection page with a stub engine: the counters show the
// species-grain counts, every chart element and facet value adds its filter
// (one URL change, read back from the query), the ST panel states the
// absence of a scheme, the heatmap and AMR facet carry the annotation
// version note for the mixed-version species, panels expand with the
// disabled export menu, and "Use as set" asks in the page and replaces the
// set with the selected identifiers. The heatmap carries its legend, and
// while the charts and the table hold the previous set's view they say they
// are updating and are aria-busy, until the current set's results arrive.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QcPoint, SetEngine, SetSummary, SpeciesCountRow } from '../src/data/setEngine';
import type { ManifestSpecies } from '../src/data/manifest';
import { exportPresets } from '../src/generated/platform';
import { palette } from '../src/generated/palette';
import { decodeFilters, encodeFilters, filtersKey, isWholeRelease } from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';
import { strings } from '../src/strings';
import { stubEngine } from './support/engine';
import { manifestFixture, ready } from './support/manifest';
import { tableAggregate } from './support/genomeTable';
import { renderApp } from './support/render';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const colors = palette.species.sequence;

const SPECIES: [string, string, number, string][] = [
  ['KPN', 'Klebsiella pneumoniae', 28, colors[0]],
  ['SEN', 'Salmonella enterica', 19, colors[1]],
  ['SMA', 'Serratia marcescens', 9, colors[3]],
  ['ABA', 'Acinetobacter baumannii', 5, colors[6]],
];

function speciesRows(codes?: string[]): SpeciesCountRow[] {
  return SPECIES.filter(([code]) => codes === undefined || codes.includes(code)).map(
    ([code, name, count, color]) => ({
      species_code: code,
      canonical_name: name,
      color,
      genome_count: count,
      complete_count: 1,
      st_count: code === 'SMA' ? 0 : 2,
      amr_hit_count: count * 3,
      plasmid_contig_count: count,
      plasmid_genome_count: count - 1,
      prophage_genome_count: 1,
    }),
  );
}

/** A species-grain view of the set restricted to its species filter. */
function summaryFor(filters: GenomeFilters): SetSummary {
  const codes = filters.species_code;
  const bySpecies = speciesRows(codes);
  const keep = (code: string) => codes === undefined || codes.includes(code);
  return {
    bySpecies,
    bySpeciesYear: bySpecies.flatMap((row) => [
      { species_code: row.species_code, year: 2019, genome_count: row.genome_count - 1 },
      { species_code: row.species_code, year: null, genome_count: 1 },
    ]),
    bySpeciesSt: [
      { species_code: 'KPN', mlst_scheme: 'klebsiella', st: '258', genome_count: 20 },
      { species_code: 'KPN', mlst_scheme: 'klebsiella', st: '11', genome_count: 8 },
      { species_code: 'SEN', mlst_scheme: 'senterica', st: '19', genome_count: 19 },
      { species_code: 'SMA', mlst_scheme: null, st: null, genome_count: 9 },
      { species_code: 'ABA', mlst_scheme: 'abaumannii', st: '2', genome_count: 5 },
    ].filter((row) => keep(row.species_code)),
    bySource: bySpecies.map((row) => ({
      species_code: row.species_code,
      source_type: 'clinical',
      country: 'CL',
      genome_count: row.genome_count,
    })),
    byPlatform: bySpecies.flatMap((row) => [
      {
        species_code: row.species_code,
        platform: 'illumina',
        assembly_status: 'draft',
        genome_count: row.genome_count - 1,
      },
      {
        species_code: row.species_code,
        platform: 'ont',
        assembly_status: 'complete',
        genome_count: 1,
      },
    ]),
    amrClassBySpecies: [
      {
        species_code: 'KPN',
        drug_class: 'carbapenem',
        genome_count: 14,
        fraction: 0.5,
        hit_count: 14,
      },
      {
        species_code: 'KPN',
        drug_class: 'beta_lactam',
        genome_count: 28,
        fraction: 1,
        hit_count: 40,
      },
      {
        species_code: 'SEN',
        drug_class: 'beta_lactam',
        genome_count: 10,
        fraction: 10 / 19,
        hit_count: 10,
      },
    ].filter((row) => keep(row.species_code)),
  };
}

const QC: QcPoint[] = [
  { genome_id: 'KPN0001', species_code: 'KPN', completeness: 99, contamination: 1, flag: 'pass' },
  {
    genome_id: 'KPN0004',
    species_code: 'KPN',
    completeness: 91.4,
    contamination: 1.2,
    flag: 'fail',
  },
  {
    genome_id: 'KPN0009',
    species_code: 'KPN',
    completeness: null,
    contamination: null,
    flag: 'missing',
  },
];

const manifestSpecies: ManifestSpecies[] = SPECIES.map(([code, name, count]) => ({
  species_code: code,
  canonical_name: name,
  genome_count: count,
  has_pangenome: false,
  tree_ids: [],
  annotation_versions:
    code === 'SEN'
      ? { amrfinderplus: ['2024-07-22.1', '2025-12-03.1'], bakta: ['5.1', '6.0'] }
      : { amrfinderplus: ['2025-12-03.1'], bakta: ['6.0'] },
}));

const synth = ready(manifestFixture({ genome_count: 61, species: manifestSpecies }));

interface Calls {
  summarize: string[];
  sql: string[];
}

function engine(calls: Calls = { summarize: [], sql: [] }): SetEngine {
  return stubEngine({
    countSet: (filters) =>
      Promise.resolve(summaryFor(filters).bySpecies.reduce((t, r) => t + r.genome_count, 0)),
    releaseSummaries: () => Promise.resolve(summaryFor({})),
    summarize: (filters) => {
      calls.summarize.push(filtersKey(filters));
      return Promise.resolve(summaryFor(filters));
    },
    mobileCounts: () => Promise.resolve({ plasmidContig: 40, prophage: 12 }),
    qcPoints: () => Promise.resolve(QC),
    aggregate: tableAggregate(calls.sql),
  });
}

function main() {
  return screen.getByRole('main');
}

function panel(name: string | RegExp) {
  return within(main()).getByRole('region', { name });
}

function current(): GenomeFilters {
  return decodeFilters(window.location.search);
}

async function rendered(path = '/', calls?: Calls, use: SetEngine = engine(calls)) {
  renderApp(path, synth, use);
  await within(main()).findByRole('table', { name: strings.panelGenomes });
  await within(panel(strings.panelSpecies)).findAllByRole('button', { name: / genomes$/ });
}

describe('collection page', () => {
  it('shows the five counters from the species-grain view (C1)', async () => {
    const calls: Calls = { summarize: [], sql: [] };
    await rendered('/', calls);
    const strip = screen.getByLabelText(strings.countersLabel);
    const values = within(strip)
      .getAllByRole('definition')
      .map((node) => node.textContent);
    // 61 genomes, 4 species, 6 STs, 183 hits, 61 plasmid contigs.
    expect(values).toEqual(['61', '4', '6', '183', '61']);
    expect(calls.summarize).toContain('{}');
  });

  it('adds the species filter from a bar (C2)', async () => {
    await rendered();
    fireEvent.click(
      within(panel(strings.panelSpecies)).getByRole('button', {
        name: strings.speciesBarName('Serratia marcescens', '9', 9),
      }),
    );
    expect(current()).toEqual({ species_code: ['SMA'] });
    const chips = within(screen.getByRole('banner')).getByRole('list', {
      name: strings.activeFiltersLabel,
    });
    expect(within(chips).getByText('Serratia marcescens')).toBeTruthy();
  });

  it('adds the species and the class from a heatmap cell (C2)', async () => {
    await rendered();
    fireEvent.click(
      within(panel(strings.panelAmrClass)).getByRole('button', {
        name: strings.heatmapCellName('Klebsiella pneumoniae', strings.drugClassCarbapenem, '50'),
      }),
    );
    expect(current()).toEqual({ drug_class: ['carbapenem'], species_code: ['KPN'] });
  });

  it('narrows to the species and the year of a segment and states the undated genomes (C2)', async () => {
    await rendered();
    const year = panel(strings.panelYear);
    expect(within(year).getByText(new RegExp(strings.yearUndated('4')))).toBeTruthy();
    fireEvent.click(
      within(year).getByRole('button', {
        name: strings.yearSegmentName('Klebsiella pneumoniae', 2019, '27', 27),
      }),
    );
    expect(current()).toEqual({ species_code: ['KPN'], year: { max: 2019, min: 2019 } });
  });

  it('narrows to the year alone from a year label (C2)', async () => {
    await rendered();
    const year = panel(strings.panelYear);
    fireEvent.click(within(year).getByRole('button', { name: /^2019: / }));
    expect(current()).toEqual({ year: { max: 2019, min: 2019 } });
  });

  it('adds the species and the ST from an ST bar of the largest species', async () => {
    await rendered();
    const st = panel(/^Sequence types Klebsiella pneumoniae/);
    fireEvent.click(within(st).getByRole('button', { name: strings.stBarName('ST258', '20', 20) }));
    expect(current()).toEqual({ species_code: ['KPN'], st: ['258'] });
  });

  it('states that a species without a scheme has no STs (C8)', async () => {
    await rendered(`/${encodeFilters({ species_code: ['SMA'] })}`);
    const st = panel(/^Sequence types Serratia marcescens/);
    await within(st).findByText(strings.stNoScheme);
    expect(within(st).queryAllByRole('button', { name: /genomes$/ })).toHaveLength(0);
  });

  it('toggles filters from the facet rail (C2)', async () => {
    await rendered();
    const rail = screen.getByRole('complementary', { name: strings.facetsLabel });
    fireEvent.click(
      within(rail).getByRole('checkbox', {
        name: strings.facetOptionName(strings.sourceTypeClinical, '61', 61),
      }),
    );
    expect(current()).toEqual({ source_type: ['clinical'] });
    fireEvent.click(
      within(rail).getByRole('checkbox', {
        name: strings.facetOptionName(strings.facetPlasmidContig, '40', 40),
      }),
    );
    expect(current()).toEqual({ plasmid_contig: true, source_type: ['clinical'] });
    const checked = within(rail).getByRole<HTMLInputElement>('checkbox', {
      name: strings.facetOptionName(strings.facetPlasmidContig, '40', 40),
    });
    expect(checked.checked).toBe(true);
    fireEvent.click(checked);
    expect(current()).toEqual({ source_type: ['clinical'] });
  });

  it('shows the annotation version note with the mixed-version species (G13)', async () => {
    await rendered();
    const heatmap = panel(strings.panelAmrClass);
    const note = within(heatmap).getByRole('note');
    expect(note.textContent).toContain('5.1, 6.0');
    expect(note.textContent).toContain('2024-07-22.1, 2025-12-03.1');
    expect(within(note).getByRole('link', { name: strings.annotationVersionMethods })).toBeTruthy();
    const rail = screen.getByRole('complementary', { name: strings.facetsLabel });
    expect(within(rail).getByRole('note')).toBeTruthy();
    // The §5.5 footnote for a set that mixes platforms.
    expect(within(heatmap).getByText(strings.footnoteMixedAssemblies)).toBeTruthy();
  });

  it('leaves the note out without the mixed-version species', async () => {
    await rendered(`/${encodeFilters({ species_code: ['KPN'] })}`);
    await waitFor(() => {
      expect(within(panel(strings.panelAmrClass)).queryByRole('note')).toBeNull();
    });
  });

  it('replaces the heatmap by a note below the compact breakpoint', async () => {
    await rendered();
    const heatmap = panel(strings.panelAmrClass);
    const note = within(heatmap).getByText(strings.heatmapNeedsWidth);
    expect(note.className.split(/\s+/)).toContain('compact:hidden');
    const grid = within(heatmap).getByRole('table', { name: strings.panelAmrClass });
    expect(grid.className.split(/\s+/)).toContain('max-compact:hidden');
  });

  it('shows the heatmap legend at rest and expanded, hidden with the grid when narrow (§8)', async () => {
    await rendered();
    const heatmap = panel(strings.panelAmrClass);
    const legend = () => within(heatmap).getByRole('list', { name: strings.heatmapLegendLabel });
    const labels = () =>
      within(legend())
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    const expected = [
      strings.heatmapLegendZero,
      strings.heatmapLegendRange('1', '14'),
      strings.heatmapLegendRange('15', '28'),
      strings.heatmapLegendRange('29', '42'),
      strings.heatmapLegendRange('43', '57'),
      strings.heatmapLegendRange('58', '71'),
      strings.heatmapLegendRange('72', '85'),
      strings.heatmapLegendRange('86', '100'),
    ];
    expect(labels()).toEqual(expected);
    expect(legend().className.split(/\s+/)).toEqual(
      expect.arrayContaining(['font-mono', 'max-compact:hidden']),
    );
    const swatches = [...legend().querySelectorAll('li > span')] as HTMLElement[];
    expect(swatches[0]?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['border', 'bg-panel']),
    );
    expect(swatches.slice(1).map((swatch) => swatch.style.backgroundColor)).toHaveLength(7);
    // Not part of the grid of cells.
    expect(
      within(heatmap).getByRole('table', { name: strings.panelAmrClass }).contains(legend()),
    ).toBe(false);
    fireEvent.click(
      within(heatmap).getByRole('button', { name: strings.panelExpandName(strings.panelAmrClass) }),
    );
    expect(labels()).toEqual(expected);
  });

  it('counts flagged and missing QC points and describes the keyboard route (C3)', async () => {
    await rendered();
    const qc = panel(strings.panelQc);
    expect(within(qc).getByText(new RegExp(strings.qcFlagged('1')))).toBeTruthy();
    expect(within(qc).getByText(new RegExp(strings.qcMissing('1')))).toBeTruthy();
    const plot = within(qc).getByRole('img', { name: strings.qcChartName });
    expect(plot.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(qc).getByText(strings.qcBrushDescription)).toBeTruthy();
  });

  it('draws the QC axes and thresholds as crisp 1 px ink hairlines, thresholds dashed (§7, G3)', async () => {
    await rendered();
    const plot = within(panel(strings.panelQc)).getByRole('img', { name: strings.qcChartName });
    const lines = [...plot.querySelectorAll('line')];
    expect(lines).toHaveLength(4);
    const group = lines[0]?.parentElement;
    expect(group?.getAttribute('stroke')).toBe(palette.chrome.ink);
    expect(group?.getAttribute('stroke-width')).toBe('1');
    expect(group?.getAttribute('shape-rendering')).toBe('crispEdges');
    for (const line of lines) {
      expect(line.parentElement).toBe(group);
      expect(line.getAttribute('stroke-width')).toBeNull();
      // Horizontal lines sit on a half-pixel row, vertical ones on a half-pixel column.
      const horizontal = line.getAttribute('y1') === line.getAttribute('y2');
      const across = Number(line.getAttribute(horizontal ? 'y1' : 'x1'));
      expect(across % 1).toBe(0.5);
    }
    expect(lines.filter((line) => line.getAttribute('stroke-dasharray') !== null)).toHaveLength(2);
  });

  it('expands every panel full-width with the export menu (C6)', async () => {
    await rendered();
    for (const name of [
      strings.panelSpecies,
      /^Sequence types/,
      strings.panelAmrClass,
      strings.panelYear,
      strings.panelQc,
      strings.panelGenomes,
    ]) {
      const region = panel(name);
      const toggle = within(region).getByRole('button', { name: /^Expand / });
      fireEvent.click(toggle);
      expect(region.className.split(/\s+/)).toContain('col-span-full');
      const menu = within(region).getByRole('group', { name: strings.exportMenuLabel });
      const entries = within(menu).getAllByRole('button');
      if (name === strings.panelGenomes) {
        expect(entries.map((entry) => entry.textContent)).toEqual([
          strings.exportCsvShown,
          strings.exportCsvSet,
        ]);
        expect(within(menu).getByText(strings.exportTableUnavailable)).toBeTruthy();
      } else {
        expect(entries.map((entry) => entry.textContent)).toEqual(
          exportPresets.map((preset) => strings[preset.labelKey]),
        );
        expect(within(menu).getByText(strings.exportFigureUnavailable)).toBeTruthy();
      }
      expect(entries.every((entry) => (entry as HTMLButtonElement).disabled)).toBe(true);
      fireEvent.click(within(region).getByRole('button', { name: /^Collapse / }));
      expect(region.className.split(/\s+/)).not.toContain('col-span-full');
      expect(within(region).queryByRole('group', { name: strings.exportMenuLabel })).toBeNull();
    }
  });
});

describe('genome table (C5, G2, G11)', () => {
  it('sets identifiers in monospace with links, species in italic sans', async () => {
    await rendered(`/${encodeFilters({ country: ['CL'] })}`);
    const table = within(main()).getByRole('table', { name: strings.panelGenomes });
    const id = within(table).getByRole('link', { name: 'KPN0001' });
    expect(id.getAttribute('href')).toBe(`/genomes/KPN0001${encodeFilters({ country: ['CL'] })}`);
    expect(id.className.split(/\s+/)).toContain('font-mono');
    const species = within(table).getAllByTitle('Klebsiella pneumoniae')[0];
    expect(species?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['font-sans', 'italic']),
    );
    expect(species?.closest('a')?.getAttribute('href')).toBe(
      `/${encodeFilters({ species_code: ['KPN'] })}`,
    );
    const st = within(table).getAllByRole('link', { name: 'ST258' })[0];
    expect(st?.getAttribute('href')).toBe(
      `/${encodeFilters({ species_code: ['KPN'], st: ['258'] })}`,
    );
  });

  // A new table page is drawn at low priority (a transition), so on a slow CI
  // runner it can take longer than Testing Library's default 1 s wait. The
  // assertions are unchanged; only the time allowed to settle is longer.
  const pageWait = { timeout: 5000 };

  it('pages and sorts in the query', async () => {
    const calls: Calls = { summarize: [], sql: [] };
    await rendered('/', calls);
    const table = () => within(main()).getByRole('table', { name: strings.panelGenomes });
    expect(calls.sql.at(-1)).toMatch(/ORDER BY t\.genome_id ASC LIMIT 50 OFFSET 0$/);
    expect(within(main()).getByText(strings.tablePageOf('1', '2'))).toBeTruthy();
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableNext }));
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    expect(calls.sql.at(-1)).toMatch(/LIMIT 50 OFFSET 50$/);
    fireEvent.click(
      within(table()).getByRole('button', { name: strings.tableSortBy(strings.tableColumnAmr) }),
    );
    await waitFor(() => {
      expect(calls.sql.at(-1)).toMatch(
        /ORDER BY t\.amr_gene_count DESC NULLS LAST, t\.genome_id ASC LIMIT 50 OFFSET 0$/,
      );
    }, pageWait);
  });

  it('adds a chooser column', async () => {
    await rendered();
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableColumns }));
    fireEvent.click(within(main()).getByRole('checkbox', { name: strings.tableColumnN50 }));
    const table = within(main()).getByRole('table', { name: strings.panelGenomes });
    expect(
      within(table).getByRole('columnheader', { name: new RegExp(strings.tableColumnN50) }),
    ).toBeTruthy();
    expect(within(table).getAllByText('250,000').length).toBeGreaterThan(0);
  });

  it('keeps the selection across pages and uses it as the set after confirming', async () => {
    await rendered();
    const table = () => within(main()).getByRole('table', { name: strings.panelGenomes });
    fireEvent.click(
      within(table()).getByRole('checkbox', { name: strings.tableSelectRow('KPN0002') }),
    );
    fireEvent.click(within(main()).getByRole('button', { name: strings.tableNext }));
    await within(table()).findByRole('link', { name: 'KPN0051' }, pageWait);
    fireEvent.click(
      within(table()).getByRole('checkbox', { name: strings.tableSelectRow('KPN0060') }),
    );
    expect(within(main()).getByText(strings.tableSelected('2'))).toBeTruthy();
    fireEvent.click(within(main()).getByRole('button', { name: strings.tablePrevious }));
    await within(table()).findByRole('link', { name: 'KPN0001' }, pageWait);
    const kept = within(table()).getByRole<HTMLInputElement>('checkbox', {
      name: strings.tableSelectRow('KPN0002'),
    });
    expect(kept.checked).toBe(true);

    fireEvent.click(within(main()).getByRole('button', { name: strings.useAsSet }));
    const dialog = within(main()).getByRole('alertdialog', { name: strings.useAsSet });
    expect(within(dialog).getByText(strings.useAsSetConfirm('2', 2))).toBeTruthy();
    expect(current()).toEqual({});
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: strings.useAsSetApply }));
      await Promise.resolve();
    });
    expect(current()).toEqual({ genome_id: ['KPN0002', 'KPN0060'] });
  });

  it('selects every row of the page', async () => {
    await rendered();
    fireEvent.click(within(main()).getByRole('checkbox', { name: strings.tableSelectPage }));
    expect(within(main()).getByText(strings.tableSelected('50'))).toBeTruthy();
  });
});

describe('held views (requirements §6.1, §9)', () => {
  it('marks the charts and the table as updating until the set arrives, then clears', async () => {
    const base = engine();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const slow: SetEngine = {
      ...base,
      summarize: async (filters) => {
        if (!isWholeRelease(filters)) await gate;
        return base.summarize(filters);
      },
    };
    await rendered('/', undefined, slow);
    const names = [
      strings.panelSpecies,
      strings.panelAmrClass,
      strings.panelYear,
      strings.panelQc,
      strings.panelGenomes,
    ];
    for (const name of names) {
      expect(panel(name).getAttribute('aria-busy')).toBeNull();
      expect(within(panel(name)).queryByText(strings.panelUpdating)).toBeNull();
    }
    fireEvent.click(
      within(panel(strings.panelSpecies)).getByRole('button', {
        name: strings.speciesBarName('Serratia marcescens', '9', 9),
      }),
    );
    expect(current()).toEqual({ species_code: ['SMA'] });
    for (const name of names) {
      expect(await within(panel(name)).findByText(strings.panelUpdating)).toBeTruthy();
      expect(panel(name).getAttribute('aria-busy')).toBe('true');
    }
    // The held view is the previous set's: the Klebsiella bar is still drawn.
    expect(
      within(panel(strings.panelSpecies)).getByRole('button', {
        name: strings.speciesBarName('Klebsiella pneumoniae', '28', 28),
      }),
    ).toBeTruthy();
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => {
      expect(within(main()).queryAllByText(strings.panelUpdating)).toHaveLength(0);
    });
    for (const name of names) expect(panel(name).getAttribute('aria-busy')).toBeNull();
    expect(
      within(panel(strings.panelSpecies)).queryByRole('button', {
        name: strings.speciesBarName('Klebsiella pneumoniae', '28', 28),
      }),
    ).toBeNull();
  });
});
