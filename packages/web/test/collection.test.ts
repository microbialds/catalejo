// Requirements §5.4, §5.5, §6.1 and checklist C3, C5, C7, C8: the pure rules
// of the collection page. The "Other" grouping of chart species (with the
// synthetic release's tie), the sequence type panel's species and its
// no-scheme statement, the heatmap's seven-step scale, the brush-to-filter
// mapping, the year columns, the facet values, and the SQL of the paged and
// sorted genome table.
import { describe, expect, it } from 'vitest';
import { collectionFacets, mixesAssemblies } from '../src/collection/facets';
import {
  GENOME_COLUMNS,
  TABLE_PAGE_SIZE,
  genomePageSql,
  orderClause,
  pageCount,
} from '../src/collection/genomeTable';
import {
  HEAT_SCALE,
  HEAT_STEPS,
  buildHeatmap,
  heatFill,
  heatLegend,
  heatLegendLabel,
  heatPercent,
  heatStep,
  heatStepOfPercent,
  heatTextOnInk,
  withHeatCell,
} from '../src/collection/heatmap';
import {
  brushBounds,
  crisp,
  qcDomain,
  qcScale,
  qcSummary,
  roundTenth,
  withBrush,
} from '../src/collection/qc';
import {
  compareSt,
  stPanel,
  stPanelSpecies,
  TOP_STS,
  withStBar,
} from '../src/collection/sequenceTypes';
import {
  OTHER_KEY,
  markStyle,
  rankSpecies,
  speciesGroups,
  speciesOutline,
  withSpecies,
} from '../src/collection/species';
import type { SpeciesCount } from '../src/collection/species';
import { buildYearChart, withYear, withYearSegment, yearLabelStep } from '../src/collection/years';
import type { QcPoint, SetSummary, SpeciesCountRow } from '../src/data/setEngine';
import { palette } from '../src/generated/palette';
import { platformConfig } from '../src/generated/platform';
import { tokens } from '../src/generated/tokens';
import { shortSpeciesName, vocabularyLabel } from '../src/set/fields';
import { strings } from '../src/strings';
import { readSynthManifest } from './support/releaseSource';

const colors = palette.species.sequence;

function species(code: string, count: number, color: string = colors[0]): SpeciesCount {
  return { species_code: code, canonical_name: `${code} name`, color, genome_count: count };
}

/** The synthetic release's species counts, from its manifest. */
function synthSpecies(): SpeciesCount[] {
  return readSynthManifest().species.map((row) => species(row.species_code, row.genome_count));
}

describe('"Other" grouping (requirements §5.4, §6.1; C7)', () => {
  it('reads the threshold from config/platform.yaml', () => {
    expect(platformConfig.chartSpeciesMax).toBe(8);
  });

  it('ranks by genome count, ties by species code', () => {
    const ranked = rankSpecies([species('SPN', 4), species('EHO', 3), species('EFM', 4)]);
    expect(ranked.map((row) => row.species_code)).toEqual(['EFM', 'SPN', 'EHO']);
  });

  it('keeps EFM and groups SPN and EHO on the synthetic release', () => {
    const groups = speciesGroups(synthSpecies());
    expect(groups.map((group) => group.key)).toEqual([
      'KPN',
      'SEN',
      'SAU',
      'SMA',
      'ECO',
      'PAE',
      'ABA',
      'EFM',
      OTHER_KEY,
    ]);
    const other = groups.at(-1);
    expect(other).toMatchObject({
      label: strings.chartOther,
      isSpecies: false,
      color: palette.species.other,
      codes: ['SPN', 'EHO'],
      genomeCount: 7,
    });
  });

  it('has no "Other" with eight species or fewer', () => {
    const eight = synthSpecies()
      .sort((a, b) => b.genome_count - a.genome_count)
      .slice(0, 8);
    const groups = speciesGroups(eight);
    expect(groups).toHaveLength(8);
    expect(groups.some((group) => group.key === OTHER_KEY)).toBe(false);
  });

  it('groups a single ninth species', () => {
    const rows = Array.from({ length: 9 }, (_, i) => species(`S${String(i)}A`, 20 - i));
    const groups = speciesGroups(rows);
    expect(groups).toHaveLength(9);
    expect(groups.at(-1)?.codes).toEqual(['S8A']);
  });

  it('ignores species without genomes in the set', () => {
    expect(speciesGroups([species('KPN', 3), species('ECO', 0)]).map((g) => g.key)).toEqual([
      'KPN',
    ]);
  });

  it('narrows the species filter to the clicked group', () => {
    expect(withSpecies({ species_code: ['KPN', 'ECO'], country: ['CL'] }, ['KPN'])).toEqual({
      country: ['CL'],
      species_code: ['KPN'],
    });
    expect(withSpecies({}, ['SPN', 'EHO'])).toEqual({ species_code: ['EHO', 'SPN'] });
  });

  it('outlines the yellow species marks from the design tokens', () => {
    const yellow = colors[6];
    expect(speciesOutline(yellow)).toEqual({ width: '0.5px', color: palette.chrome.ink });
    expect(speciesOutline(yellow.toLowerCase())).toBeDefined();
    expect(speciesOutline(colors[0])).toBeUndefined();
    expect(markStyle(yellow).outline).toBe(`0.5px solid ${tokens.color.ink}`);
    expect(markStyle(colors[0])).toEqual({ backgroundColor: colors[0] });
  });

  it('abbreviates the genus for charts and tables', () => {
    expect(shortSpeciesName('Klebsiella pneumoniae')).toBe('K. pneumoniae');
    expect(shortSpeciesName('K. pneumoniae')).toBe('K. pneumoniae');
    expect(shortSpeciesName('Klebsiella')).toBe('Klebsiella');
  });
});

describe('sequence type panel (requirements §6.1; C8)', () => {
  const bySpecies = [species('KPN', 28), species('SEN', 19), species('SMA', 9)];

  it('shows the single species of the filter, else the largest of the set', () => {
    expect(stPanelSpecies({ species_code: ['SMA'] }, bySpecies)).toBe('SMA');
    expect(stPanelSpecies({ species_code: ['SMA', 'SEN'] }, bySpecies)).toBe('KPN');
    expect(stPanelSpecies({}, bySpecies)).toBe('KPN');
    expect(stPanelSpecies({}, [species('EFM', 4), species('SPN', 4)])).toBe('EFM');
    expect(stPanelSpecies({}, [])).toBeUndefined();
  });

  it('states that a species without an ST scheme has no sequence types', () => {
    const panel = stPanel(
      [{ species_code: 'SMA', mlst_scheme: null, st: null, genome_count: 9 }],
      'SMA',
    );
    expect(panel).toEqual({ noScheme: true, bars: [], untyped: 9 });
  });

  it('draws the top STs and the rest as "other", untyped genomes apart', () => {
    const rows = [
      ['258', 9],
      ['147', 6],
      ['307', 5],
      ['11', 4],
      ['25', 3],
      ['15', 3],
      ['ST258-1LV', 1],
      [null, 2],
    ].map(([st, count]) => ({
      species_code: 'KPN',
      mlst_scheme: 'klebsiella',
      st: st as string | null,
      genome_count: count as number,
    }));
    rows.push({ species_code: 'ECO', mlst_scheme: 'ecoli', st: '11', genome_count: 50 });
    const panel = stPanel(rows, 'KPN');
    expect(panel.noScheme).toBe(false);
    expect(panel.untyped).toBe(2);
    expect(panel.bars).toHaveLength(TOP_STS + 1);
    // 25 and 15 tie at 3: numeric order keeps 15 first.
    expect(panel.bars.slice(0, TOP_STS).map((bar) => bar.values[0])).toEqual([
      '258',
      '147',
      '307',
      '11',
      '15',
    ]);
    expect(panel.bars.at(-1)).toEqual({
      values: ['25', 'ST258-1LV'],
      isOther: true,
      genomeCount: 4,
    });
  });

  it('orders STs numerically when all digits', () => {
    expect(['258', '11', 'ST258-1LV', '2'].sort(compareSt)).toEqual([
      '2',
      '11',
      '258',
      'ST258-1LV',
    ]);
  });

  it('labels STs as the chips do', () => {
    expect(strings.chipSt('258')).toBe('ST258');
    expect(strings.chipSt('ST258-1LV')).toBe('ST258-1LV');
  });

  it('clicking a bar replaces the species and the STs already chosen (§6.1, C2)', () => {
    const bar = { values: ['258'], isOther: false, genomeCount: 9 };
    // The critic's case: KPN with ST147 and ST258, then the ST258 bar.
    expect(withStBar({ species_code: ['KPN'], st: ['147', '258'] }, 'KPN', bar)).toEqual({
      species_code: ['KPN'],
      st: ['258'],
    });
    expect(withStBar({ st: ['11'], source_type: ['food'] }, 'KPN', bar)).toEqual({
      source_type: ['food'],
      species_code: ['KPN'],
      st: ['258'],
    });
    const other = { values: ['25', '15'], isOther: true, genomeCount: 6 };
    expect(withStBar({ species_code: ['KPN'], st: ['258'] }, 'KPN', other)).toEqual({
      species_code: ['KPN'],
      st: ['15', '25'],
    });
  });

  it('clicking a bar filters by the species and its STs', () => {
    const bar = { values: ['258'], isOther: false, genomeCount: 9 };
    expect(withStBar({}, 'KPN', bar)).toEqual({ species_code: ['KPN'], st: ['258'] });
    expect(withStBar({ species_code: ['KPN', 'ECO'] }, 'KPN', bar)).toEqual({
      species_code: ['KPN'],
      st: ['258'],
    });
    const other = { values: ['25', '15'], isOther: true, genomeCount: 6 };
    expect(withStBar({ country: ['CL'] }, 'KPN', other)).toEqual({
      country: ['CL'],
      species_code: ['KPN'],
      st: ['15', '25'],
    });
  });
});

describe('heatmap cell click (requirements §6.1; C2)', () => {
  it('replaces the species and the drug class already chosen', () => {
    // The critic's case: aminoglycoside chosen, then the S. enterica quinolone cell.
    expect(withHeatCell({ drug_class: ['aminoglycoside'] }, ['SEN'], 'quinolone')).toEqual({
      drug_class: ['quinolone'],
      species_code: ['SEN'],
    });
    expect(
      withHeatCell(
        { drug_class: ['carbapenem'], species_code: ['ECO', 'KPN'] },
        ['KPN'],
        'beta_lactam',
      ),
    ).toEqual({ drug_class: ['beta_lactam'], species_code: ['KPN'] });
  });

  it('keeps the other fields and sets the species of "Other"', () => {
    expect(withHeatCell({ source_type: ['food'] }, ['SPN', 'EHO'], 'macrolide')).toEqual({
      drug_class: ['macrolide'],
      source_type: ['food'],
      species_code: ['EHO', 'SPN'],
    });
  });
});

describe('heatmap scale (palette.sequential.heatmap)', () => {
  it('maps a fraction above zero to one of the seven steps, zero to none', () => {
    expect(HEAT_SCALE).toEqual(palette.sequential.heatmap);
    expect(HEAT_STEPS).toBe(7);
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.01)).toBe(1);
    expect(heatStep(0.144)).toBe(1);
    expect(heatStep(0.15)).toBe(2);
    expect(heatStep(0.49)).toBe(4);
    expect(heatStep(0.5)).toBe(4);
    expect(heatStep(0.58)).toBe(5);
    expect(heatStep(0.86)).toBe(7);
    expect(heatStep(0.99)).toBe(7);
    expect(heatStep(1)).toBe(7);
  });

  it('paints the step of the integer percent the cell prints (critic round 3, observation 1)', () => {
    // 2 of 14 prints 14, 4 of 7 prints 57, 5 of 7 prints 71: each paints the
    // step whose legend range holds the printed number.
    const cases: [number, number, number][] = [
      [2 / 14, 14, 1],
      [1 / 7, 14, 1],
      [2 / 7, 29, 3],
      [3 / 7, 43, 4],
      [4 / 7, 57, 4],
      [5 / 7, 71, 5],
      [6 / 7, 86, 7],
    ];
    for (const [fraction, printed, step] of cases) {
      expect(heatPercent(fraction)).toBe(printed);
      expect(heatStep(fraction)).toBe(step);
      expect(heatStepOfPercent(printed)).toBe(step);
    }
    expect(heatStepOfPercent(0)).toBe(0);
    expect(heatPercent(0)).toBe(0);
  });

  it('fills each step solid with its palette color and leaves zero on the panel', () => {
    expect(heatFill(0)).toBeUndefined();
    expect([1, 2, 3, 4, 5, 6, 7].map(heatFill)).toEqual([...palette.sequential.heatmap]);
  });

  it('sets on-ink text on the last three steps and integer percents', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(heatTextOnInk)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(heatPercent(0.284)).toBe(28);
    expect(heatPercent(0.995)).toBe(100);
  });

  it('labels the legend with the integer percents each step holds (§8)', () => {
    const legend = heatLegend();
    expect(legend.map((entry) => entry.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(legend.map((entry) => entry.fill)).toEqual([undefined, ...palette.sequential.heatmap]);
    expect(legend.map(heatLegendLabel)).toEqual([
      strings.heatmapLegendZero,
      strings.heatmapLegendRange('1', '14'),
      strings.heatmapLegendRange('15', '28'),
      strings.heatmapLegendRange('29', '42'),
      strings.heatmapLegendRange('43', '57'),
      strings.heatmapLegendRange('58', '71'),
      strings.heatmapLegendRange('72', '85'),
      strings.heatmapLegendRange('86', '100'),
    ]);
    // Each range agrees with the mapping: every integer percent in it maps to
    // its step, the ranges tile 1 to 100 without gaps, and zero takes no step.
    expect(heatStep(0)).toBe(legend[0]?.step);
    let next = 1;
    for (const entry of legend.slice(1)) {
      expect(entry.min).toBe(next);
      for (let percent = entry.min; percent <= entry.max; percent += 1) {
        expect(heatStepOfPercent(percent), `${String(percent)}%`).toBe(entry.step);
      }
      next = entry.max + 1;
    }
    expect(next).toBe(101);
    // For every integer 1 to 100, a cell whose fraction prints that integer
    // paints the step of the legend range that holds it.
    for (let percent = 1; percent <= 100; percent += 1) {
      const entry = legend.find((item) => item.min <= percent && percent <= item.max);
      for (const fraction of [percent / 100, (percent - 0.49) / 100, (percent + 0.49) / 100]) {
        if (fraction > 1) continue;
        expect(heatPercent(fraction), String(fraction)).toBe(percent);
        expect(heatStep(fraction), `${String(percent)}% from ${String(fraction)}`).toBe(
          entry?.step,
        );
      }
    }
  });

  it('builds rows per group and columns per class present, in palette order', () => {
    const groups = speciesGroups(
      Array.from({ length: 9 }, (_, i) => species(`S${String(i)}A`, 10 - i)),
    );
    const rows = [
      { species_code: 'S0A', drug_class: 'colistin', genome_count: 5, fraction: 0.5, hit_count: 5 },
      {
        species_code: 'S0A',
        drug_class: 'beta_lactam',
        genome_count: 10,
        fraction: 1,
        hit_count: 12,
      },
      {
        species_code: 'S8A',
        drug_class: 'carbapenem',
        genome_count: 1,
        fraction: 0.5,
        hit_count: 1,
      },
      { species_code: 'S7A', drug_class: 'carbapenem', genome_count: 0, fraction: 0, hit_count: 0 },
    ];
    const heatmap = buildHeatmap(groups, rows);
    expect(heatmap.classes).toEqual(['beta_lactam', 'carbapenem', 'colistin']);
    expect(heatmap.rows).toHaveLength(9);
    expect(heatmap.rows[0]?.cells.map((cell) => cell.fraction)).toEqual([1, 0, 0.5]);
    // Other is S8A alone (2 genomes), one with a carbapenem hit.
    expect(heatmap.rows[8]?.group.key).toBe(OTHER_KEY);
    expect(heatmap.rows[8]?.cells[1]).toEqual({
      drugClass: 'carbapenem',
      genomeCount: 1,
      fraction: 0.5,
    });
  });
});

describe('QC scatter and brush (C3)', () => {
  const point = (
    id: string,
    completeness: number | null,
    contamination: number | null,
    flag = 'pass',
  ): QcPoint => ({
    genome_id: id,
    species_code: 'KPN',
    completeness,
    contamination,
    flag,
  });

  it('reads the thresholds from config/platform.yaml', () => {
    expect(platformConfig.qc).toEqual({ completenessMin: 95, contaminationMax: 5 });
  });

  it('spans 80 to 100 and 0 to 10 by default, extended by the points', () => {
    expect(qcDomain([point('a', 99, 1)])).toEqual({
      completeness: [80, 100],
      contamination: [0, 10],
    });
    expect(qcDomain([point('a', 72.4, 13.1)])).toEqual({
      completeness: [70, 100],
      contamination: [0, 15],
    });
  });

  it('counts flagged genomes and leaves out missing values', () => {
    const summary = qcSummary([
      point('a', 99, 1),
      point('b', 91.4, 1.2, 'fail'),
      point('c', null, null, 'missing'),
      point('d', 97, 6.4, 'fail'),
    ]);
    expect(summary.drawn.map((p) => p.genome_id)).toEqual(['a', 'b', 'd']);
    expect(summary.flagged).toBe(2);
    expect(summary.missing).toBe(1);
  });

  it('maps the rectangle to the left completeness and top contamination', () => {
    const domain = {
      completeness: [80, 100] as [number, number],
      contamination: [0, 10] as [number, number],
    };
    const scale = qcScale(domain, { left: 30, top: 4, width: 200, height: 80 });
    expect(scale.x(80)).toBe(30);
    expect(scale.x(100)).toBe(230);
    expect(scale.y(0)).toBe(84);
    expect(scale.y(10)).toBe(4);
    // Dragged from bottom right to top left: left x is 130 (90%), top y is 44 (5%).
    expect(brushBounds({ x0: 200, y0: 80, x1: 130, y1: 44 }, scale)).toEqual({
      completenessMin: 90,
      contaminationMax: 5,
    });
    expect(brushBounds({ x0: 141.3, y0: 21.7, x1: 220, y1: 70 }, scale)).toEqual({
      completenessMin: 91.1,
      contaminationMax: 7.8,
    });
    expect(roundTenth(95.04999)).toBe(95);
  });

  it('puts hairlines on half-pixel coordinates so a 1 px stroke paints one pixel row', () => {
    expect(crisp(84)).toBe(84.5);
    expect(crisp(30)).toBe(30.5);
    expect(crisp(37.3)).toBe(37.5);
    expect(crisp(37.9)).toBe(37.5);
    const scale = qcScale(
      { completeness: [80, 100], contamination: [0, 10] },
      { left: 30, top: 4, width: 271.4, height: 80 },
    );
    // Threshold lines land between scale steps; snapped, both ends share one pixel row.
    const y = crisp(scale.y(platformConfig.qc.contaminationMax));
    const x = crisp(scale.x(platformConfig.qc.completenessMin));
    expect(y % 1).toBe(0.5);
    expect(x % 1).toBe(0.5);
    expect(Math.abs(y - scale.y(platformConfig.qc.contaminationMax))).toBeLessThanOrEqual(0.5);
  });

  it('replaces earlier completeness and contamination filters in one change', () => {
    expect(
      withBrush(
        { completeness_min: 99, contamination_max: 1, species_code: ['KPN'] },
        { completenessMin: 90, contaminationMax: 5 },
      ),
    ).toEqual({ completeness_min: 90, contamination_max: 5, species_code: ['KPN'] });
  });
});

describe('year clicks (requirements §6.1; C2)', () => {
  it('a year label sets only the year, replacing the range already chosen', () => {
    expect(withYear({ year: { min: 2015, max: 2018 }, species_code: ['KPN'] }, 2016)).toEqual({
      species_code: ['KPN'],
      year: { min: 2016, max: 2016 },
    });
  });

  it('a segment sets its species and its year', () => {
    expect(
      withYearSegment({ species_code: ['KPN', 'SEN'], year: { min: 2015 } }, ['SAU'], 2019),
    ).toEqual({ species_code: ['SAU'], year: { min: 2019, max: 2019 } });
    expect(withYearSegment({ country: ['CL'] }, ['SPN', 'EHO'], 2020)).toEqual({
      country: ['CL'],
      species_code: ['EHO', 'SPN'],
      year: { min: 2020, max: 2020 },
    });
  });
});

describe('genomes by year', () => {
  it('stacks by group, fills gap years and counts undated genomes', () => {
    const groups = speciesGroups([species('KPN', 3), species('ECO', 2)]);
    const chart = buildYearChart(groups, [
      { species_code: 'KPN', year: 2018, genome_count: 2 },
      { species_code: 'ECO', year: 2018, genome_count: 1 },
      { species_code: 'ECO', year: 2020, genome_count: 1 },
      { species_code: 'KPN', year: null, genome_count: 1 },
    ]);
    expect(chart.undated).toBe(1);
    expect(chart.maxTotal).toBe(3);
    expect(chart.columns.map((column) => [column.year, column.total])).toEqual([
      [2018, 3],
      [2019, 0],
      [2020, 1],
    ]);
    expect(chart.columns[0]?.segments.map((segment) => segment.group.key)).toEqual(['KPN', 'ECO']);
  });

  it('thins axis labels for long ranges', () => {
    expect(yearLabelStep(11, 12)).toBe(1);
    expect(yearLabelStep(37, 12)).toBe(4);
  });
});

function summary(overrides: Partial<SetSummary> = {}): SetSummary {
  return {
    bySpecies: [],
    bySpeciesYear: [],
    bySpeciesSt: [],
    bySource: [],
    byPlatform: [],
    amrClassBySpecies: [],
    ...overrides,
  };
}

function speciesRow(code: string, count: number): SpeciesCountRow {
  return {
    ...species(code, count),
    complete_count: 0,
    st_count: 0,
    amr_hit_count: 0,
    plasmid_contig_count: 0,
    plasmid_genome_count: 0,
    prophage_genome_count: 0,
  };
}

describe('facet values', () => {
  const release = summary({
    bySpecies: [speciesRow('ECO', 8), speciesRow('KPN', 28)],
    bySource: [
      { species_code: 'KPN', source_type: 'clinical', country: 'CL', genome_count: 20 },
      { species_code: 'KPN', source_type: 'food', country: 'CL', genome_count: 8 },
      { species_code: 'ECO', source_type: 'clinical', country: null, genome_count: 8 },
    ],
    byPlatform: [
      { species_code: 'KPN', platform: 'illumina', assembly_status: 'draft', genome_count: 27 },
      { species_code: 'KPN', platform: 'ont', assembly_status: 'complete', genome_count: 1 },
    ],
    amrClassBySpecies: [
      { species_code: 'KPN', drug_class: 'colistin', genome_count: 2, fraction: 0.1, hit_count: 2 },
      {
        species_code: 'KPN',
        drug_class: 'beta_lactam',
        genome_count: 28,
        fraction: 1,
        hit_count: 30,
      },
      {
        species_code: 'ECO',
        drug_class: 'beta_lactam',
        genome_count: 8,
        fraction: 1,
        hit_count: 9,
      },
    ],
  });

  it('lists the release values with the counts of the current set', () => {
    const current = summary({
      bySpecies: [speciesRow('ECO', 8)],
      bySource: [{ species_code: 'ECO', source_type: 'clinical', country: null, genome_count: 8 }],
      amrClassBySpecies: [
        {
          species_code: 'ECO',
          drug_class: 'beta_lactam',
          genome_count: 8,
          fraction: 1,
          hit_count: 9,
        },
      ],
    });
    const facets = collectionFacets(release, current);
    expect(facets.species.map((value) => [value.value, value.count])).toEqual([
      ['KPN', 0],
      ['ECO', 8],
    ]);
    expect(facets.sourceType).toEqual([
      { value: 'clinical', count: 8 },
      { value: 'food', count: 0 },
    ]);
    expect(facets.drugClass.map((value) => value.value)).toEqual(['beta_lactam', 'colistin']);
    expect(facets.drugClass[0]?.count).toBe(8);
    expect(facets.platform.map((value) => value.value)).toEqual(['illumina', 'ont']);
  });

  it('detects sets that mix platforms or assembly statuses (§5.5)', () => {
    expect(mixesAssemblies(release)).toBe(true);
    expect(
      mixesAssemblies(
        summary({
          byPlatform: [
            {
              species_code: 'KPN',
              platform: 'illumina',
              assembly_status: 'draft',
              genome_count: 3,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('labels the controlled vocabularies and keeps other values', () => {
    expect(vocabularyLabel('source_type', 'clinical')).toBe(strings.sourceTypeClinical);
    expect(vocabularyLabel('platform', 'ont')).toBe(strings.platformOnt);
    expect(vocabularyLabel('assembly_status', 'complete')).toBe(strings.assemblyStatusComplete);
    expect(vocabularyLabel('platform', 'sanger')).toBe('sanger');
  });
});

describe('genome table SQL (C5)', () => {
  const context = {
    set: '(SELECT g.* FROM genome_facts AS g WHERE TRUE)',
    relation: (path: string) => Promise.resolve(`read_parquet('${path}')`),
  };

  it('pages by 50 with a genome_id tiebreak', async () => {
    expect(TABLE_PAGE_SIZE).toBe(50);
    const sql = await genomePageSql(context, undefined, 0);
    expect(sql).toContain(`FROM ${context.set} AS t`);
    expect(sql).toContain("read_parquet('summaries/counts_by_species.parquet')");
    expect(sql).toMatch(/ORDER BY t\.genome_id ASC LIMIT 50 OFFSET 0$/);
    expect(await genomePageSql(context, undefined, 3)).toMatch(/LIMIT 50 OFFSET 150$/);
  });

  it('sorts by the chosen column, nulls last, then by genome_id', () => {
    expect(orderClause({ id: 'amr_gene_count', desc: true })).toBe(
      'ORDER BY t.amr_gene_count DESC NULLS LAST, t.genome_id ASC',
    );
    expect(orderClause({ id: 'st', desc: false })).toBe(
      'ORDER BY TRY_CAST(t.st AS BIGINT) ASC NULLS LAST, t.st ASC NULLS LAST, t.genome_id ASC',
    );
    expect(orderClause({ id: 'species_code', desc: false })).toBe(
      'ORDER BY s.canonical_name ASC NULLS LAST, t.genome_id ASC',
    );
    expect(orderClause({ id: 'genome_id', desc: true })).toBe('ORDER BY t.genome_id DESC');
  });

  it('never puts an unknown column name in the SQL', () => {
    const clause = orderClause({ id: 'genome_id; DROP TABLE genome_facts', desc: false });
    expect(clause).toBe('ORDER BY t.genome_id ASC');
  });

  it('offers the board columns by default and the chooser columns hidden', () => {
    expect(GENOME_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.header)).toEqual([
      strings.tableColumnGenome,
      strings.tableColumnSpecies,
      strings.tableColumnSt,
      strings.tableColumnSource,
      strings.tableColumnYear,
      strings.tableColumnAmr,
      strings.tableColumnPlasmids,
      strings.tableColumnCompleteness,
    ]);
    expect(GENOME_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.id)).toEqual([
      'country',
      'platform',
      'assembly_status',
      'checkm2_contamination',
      'genome_size',
      'contig_count',
      'n50',
      'gc_content',
    ]);
  });

  it('counts pages from the set count', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(100)).toBe(2);
  });
});
