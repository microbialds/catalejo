// Requirements §5.2, §6.1 (Data) and data contract §6.1, §6.2, §7.5: the set
// predicate counts the same genomes as a direct DuckDB query over the
// synthetic release for every filter key; the engine's whole-release view
// (summaries) agrees with its genome-grain view; the search index's sequence
// type targets decode to the species and ST of their row; and no partitioned
// table is read without one species code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSingleFile, CrossSpeciesScanError, speciesTable } from '../src/data/release';
import { countersOf, createSetEngine, summarizeOverGenomes } from '../src/data/setEngine';
import type { SetEngine } from '../src/data/setEngine';
import type { PartitionedTable } from '../src/data/release';
import { decodeFilters, encodeFilters } from '../src/set/filters';
import type { GenomeFilters } from '../src/set/filters';
import {
  type ExtensionRepository,
  type NodeDatabase,
  openNodeDatabase,
  sqlString,
  startExtensionRepository,
} from './support/duckdbNode';
import { hasSynthFile, nodeSource, parquet, readSynthManifest } from './support/releaseSource';

let repository: ExtensionRepository | undefined;
let database: NodeDatabase | undefined;
let engine: SetEngine;

beforeAll(async () => {
  repository = await startExtensionRepository();
  database = await openNodeDatabase(repository.url);
  engine = createSetEngine(nodeSource(database), readSynthManifest());
});

afterAll(async () => {
  database?.close();
  await repository?.stop();
});

function query(sql: string): Record<string, unknown>[] {
  if (!database) throw new Error('DuckDB did not start');
  return database.query(sql);
}

function scalar(sql: string): number {
  const [row] = query(sql);
  return Number(Object.values(row ?? {})[0]);
}

const genome = () => parquet('tables/genome.parquet');

/** Genomes of genome.parquet whose id is in a subquery. */
function countIn(subquery: string): number {
  return scalar(`SELECT count(*) FROM ${genome()} WHERE genome_id IN (${subquery})`);
}

function count(where: string): number {
  return scalar(`SELECT count(*) FROM ${genome()} WHERE ${where}`);
}

function firstColumn(relative: string): string {
  const rows = query(`DESCRIBE SELECT * FROM ${parquet(relative)}`);
  const names = rows.map((row) => String(row.column_name));
  const column = names.find((name) => name !== 'genome_id' && name !== 'species_code');
  if (column === undefined) throw new Error(`${relative} has no presence column`);
  return column;
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface Case {
  name: string;
  filters: () => GenomeFilters;
  expected: () => number;
  /** A file the case needs, skipped while the release lacks it. */
  needs?: string;
  /** Whether the expected count must be above zero for the case to mean anything. */
  nonEmpty?: boolean;
}

const cases: Case[] = [
  {
    name: 'species_code',
    filters: () => ({ species_code: ['KPN', 'ECO'] }),
    expected: () => count(`species_code IN ('KPN', 'ECO')`),
    nonEmpty: true,
  },
  {
    name: 'st',
    filters: () => ({ st: ['258', '11'] }),
    expected: () => count(`st IN ('258', '11')`),
    nonEmpty: true,
  },
  {
    name: 'source_type',
    filters: () => ({ source_type: ['clinical'] }),
    expected: () => count(`source_type = 'clinical'`),
    nonEmpty: true,
  },
  {
    name: 'country',
    filters: () => ({ country: ['CL', 'AR'] }),
    expected: () => count(`country IN ('CL', 'AR')`),
    nonEmpty: true,
  },
  {
    name: 'year range',
    filters: () => ({ year: { min: 2018, max: 2022 } }),
    expected: () => count(`year(isolation_date) BETWEEN 2018 AND 2022`),
    nonEmpty: true,
  },
  {
    name: 'year minimum only',
    filters: () => ({ year: { min: 2021 } }),
    expected: () => count(`year(isolation_date) >= 2021`),
    nonEmpty: true,
  },
  {
    name: 'platform',
    filters: () => ({ platform: ['ont', 'hybrid'] }),
    expected: () => count(`platform IN ('ont', 'hybrid')`),
    nonEmpty: true,
  },
  {
    name: 'assembly_status',
    filters: () => ({ assembly_status: ['complete'] }),
    expected: () => count(`assembly_status = 'complete'`),
    nonEmpty: true,
  },
  {
    name: 'completeness_min',
    filters: () => ({ completeness_min: 98.5 }),
    expected: () => count(`checkm2_completeness >= 98.5`),
    nonEmpty: true,
  },
  {
    name: 'contamination_max',
    filters: () => ({ contamination_max: 1 }),
    expected: () => count(`checkm2_contamination <= 1`),
    nonEmpty: true,
  },
  {
    name: 'presence_amr',
    filters: () => ({ presence_amr: ['blaKPC-2', "aac(6')-Ib-cr5"] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('presence_amr.parquet')} WHERE "blaKPC-2" OR "aac(6')-Ib-cr5"`,
      ),
    nonEmpty: true,
  },
  {
    name: 'presence_amr with an element the release lacks',
    filters: () => ({ presence_amr: ['blaNOT-1'] }),
    expected: () => 0,
  },
  {
    name: 'drug_class',
    needs: 'summaries/amr_class_by_genome.parquet',
    filters: () => ({ drug_class: ['carbapenem', 'colistin'] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('summaries/amr_class_by_genome.parquet')} WHERE drug_class IN ('carbapenem', 'colistin')`,
      ),
    nonEmpty: true,
  },
  {
    name: 'mutation',
    filters: () => ({ mutation: ['gyrA_S83L', 'parC_S80I'] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('tables/mutation.parquet')} WHERE (gene = 'gyrA' AND variant = 'S83L') OR (gene = 'parC' AND variant = 'S80I')`,
      ),
    nonEmpty: true,
  },
  {
    name: 'replicon',
    needs: 'presence_replicon.parquet',
    filters: () => ({ replicon: [firstColumn('presence_replicon.parquet')] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('presence_replicon.parquet')} WHERE ${ident(firstColumn('presence_replicon.parquet'))}`,
      ),
    nonEmpty: true,
  },
  {
    name: 'plasmid_contig',
    filters: () => ({ plasmid_contig: true }),
    expected: () => count(`plasmid_contig_count > 0`),
    nonEmpty: true,
  },
  {
    name: 'presence_mob',
    filters: () => ({ presence_mob: [firstColumn('presence_mob.parquet')] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('presence_mob.parquet')} WHERE ${ident(firstColumn('presence_mob.parquet'))}`,
      ),
    nonEmpty: true,
  },
  {
    name: 'prophage',
    filters: () => ({ prophage: true }),
    expected: () => count(`prophage_region_count > 0`),
    nonEmpty: true,
  },
  {
    name: 'cluster without a pangenome in the release',
    filters: () => ({ cluster: ['KPN.synth.group_1'] }),
    expected: () => 0,
  },
  {
    name: 'set',
    filters: () => ({ set: ['kpc-plasmid-carriers'] }),
    expected: () =>
      countIn(
        `SELECT genome_id FROM ${parquet('tables/genome_set_member.parquet')} WHERE set_id = 'kpc-plasmid-carriers'`,
      ),
    nonEmpty: true,
  },
  {
    name: 'genome_id',
    filters: () => ({ genome_id: ['KPN0001', 'ECO0003', 'ABSENT0001'] }),
    expected: () => 2,
  },
  {
    name: 'values holding quotes',
    filters: () => ({ species_code: ["K'PN"], country: ["'); DROP TABLE genome_facts; --"] }),
    expected: () => 0,
  },
  {
    name: 'keys combined',
    filters: () => ({
      species_code: ['KPN'],
      presence_amr: ['blaKPC-2'],
      plasmid_contig: true,
      completeness_min: 95,
    }),
    expected: () =>
      count(
        `species_code = 'KPN' AND plasmid_contig_count > 0 AND checkm2_completeness >= 95 AND genome_id IN (SELECT genome_id FROM ${parquet('presence_amr.parquet')} WHERE "blaKPC-2")`,
      ),
    nonEmpty: true,
  },
];

describe('set predicate against direct DuckDB counts', () => {
  it.each(cases.map((testCase) => [testCase.name, testCase]))('%s', async (_name, testCase) => {
    if (testCase.needs !== undefined && !hasSynthFile(testCase.needs)) {
      console.warn(`skipped: releases/synth/${testCase.needs} is missing`);
      return;
    }
    const expected = testCase.expected();
    if (testCase.nonEmpty === true) expect(expected).toBeGreaterThan(0);
    expect(await engine.countSet(testCase.filters())).toBe(expected);
  });

  it('counts the whole release from the manifest', async () => {
    expect(await engine.countSet({})).toBe(readSynthManifest().genome_count);
    expect(scalar(`SELECT count(*) FROM ${genome()}`)).toBe(readSynthManifest().genome_count);
  });

  it('lists the genome identifiers of a set, sorted', async () => {
    const ids = await engine.setGenomeIds({ set: ['kpc-plasmid-carriers'] });
    const expected = query(
      `SELECT genome_id FROM ${parquet('tables/genome_set_member.parquet')} WHERE set_id = 'kpc-plasmid-carriers' ORDER BY genome_id`,
    ).map((row) => String(row.genome_id));
    expect(ids).toEqual(expected);
  });

  it('lists the species of a set', async () => {
    expect(await engine.setSpecies({ species_code: ['SEN', 'KPN'] })).toEqual(['KPN', 'SEN']);
  });

  it('offers the values of the add filter menu', async () => {
    const st = await engine.filterOptions('st');
    expect(st.map((option) => option.value)).toContain('258');
    const amr = await engine.filterOptions('presence_amr');
    expect(amr.map((option) => option.value)).toContain("aac(6')-Ib-cr5");
    const mutation = await engine.filterOptions('mutation');
    expect(mutation.map((option) => option.value)).toContain('gyrA_S83L');
    expect(engine.fieldAvailable('cluster')).toBe(false);
  });
});

describe('whole release and genome grain agree (requirements §6.1, C1)', () => {
  it('gives the same species-grain view from the summaries and from the genomes', async () => {
    const fromSummaries = await engine.summarize({});
    const fromGenomes = await summarizeOverGenomes(engine, {});
    expect(fromGenomes.bySpecies).toEqual(fromSummaries.bySpecies);
    expect(fromGenomes.bySpeciesYear).toEqual(fromSummaries.bySpeciesYear);
    expect(fromGenomes.bySpeciesSt).toEqual(fromSummaries.bySpeciesSt);
    expect(fromGenomes.bySource).toEqual(fromSummaries.bySource);
    expect(fromGenomes.byPlatform).toEqual(fromSummaries.byPlatform);
    if (hasSynthFile('summaries/amr_class_by_genome.parquet')) {
      const round = (rows: typeof fromGenomes.amrClassBySpecies) =>
        rows.map((row) => ({ ...row, fraction: Number(row.fraction.toFixed(9)) }));
      expect(round(fromGenomes.amrClassBySpecies)).toEqual(round(fromSummaries.amrClassBySpecies));
    }
  });

  it('computes the five counters of a filtered set over the genome grain', async () => {
    const counters = await engine.counters({ species_code: ['KPN'] });
    expect(counters).toEqual({
      genomes: count(`species_code = 'KPN'`),
      species: 1,
      sequenceTypes: scalar(
        `SELECT count(DISTINCT st) FROM ${genome()} WHERE species_code = 'KPN'`,
      ),
      amrHits: scalar(`SELECT sum(amr_gene_count) FROM ${genome()} WHERE species_code = 'KPN'`),
      plasmidContigs: scalar(
        `SELECT sum(plasmid_contig_count) FROM ${genome()} WHERE species_code = 'KPN'`,
      ),
    });
    const whole = countersOf((await engine.releaseSummaries()).bySpecies);
    expect(whole.genomes).toBe(readSynthManifest().genome_count);
  });

  it('counts genomes with mobile elements', async () => {
    expect(await engine.mobileCounts({ species_code: ['KPN'] })).toEqual({
      plasmidContig: count(`species_code = 'KPN' AND plasmid_contig_count > 0`),
      prophage: count(`species_code = 'KPN' AND prophage_region_count > 0`),
    });
  });

  it('reads QC points of a set', async () => {
    const points = await engine.qcPoints({ species_code: ['ECO'] });
    expect(points).toHaveLength(count(`species_code = 'ECO'`));
    expect(points.every((point) => point.species_code === 'ECO')).toBe(true);
  });
});

describe('search index sequence type targets (contract §6.2)', () => {
  it('decode to exactly the species and ST of their row', async () => {
    const rows = query(
      `SELECT term, target, species_code, count FROM ${parquet('summaries/search_index.parquet')} WHERE kind = 'st' ORDER BY term, species_code`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const term = String(row.term);
      const target = String(row.target);
      const species = String(row.species_code);
      const st = /^ST\d+$/.test(term) ? term.slice(2) : term;
      expect(target.startsWith('/?')).toBe(true);
      const search = target.slice(1);
      expect(decodeFilters(search), target).toEqual({ species_code: [species], st: [st] });
      expect(encodeFilters(decodeFilters(search))).toBe(search);
      expect(await engine.countSet(decodeFilters(search))).toBe(Number(row.count));
    }
  });
});

describe('partitioned tables (contract §6.1)', () => {
  it('reads one species partition', () => {
    expect(speciesTable('feature', 'KPN')).toBe('tables/feature/KPN.parquet');
    expect(() => {
      assertSingleFile(speciesTable('contig', 'SEN'));
    }).not.toThrow();
  });

  it.each([
    ['feature', ''],
    ['feature', 'kpn'],
    ['feature', '*'],
    ['feature', undefined],
    ['annotation_hit', 'KPN,ECO'],
  ])('refuses %s with species %s', (table, code) => {
    expect(() => speciesTable(table as PartitionedTable, code as unknown as string)).toThrow(
      CrossSpeciesScanError,
    );
  });

  it.each([
    'tables/feature/*.parquet',
    'tables/feature/',
    'tables/feature/{KPN,ECO}.parquet',
    'tables/feature/../genome.parquet',
    'tables/feature/all.parquet',
  ])('refuses the path %s', (relative) => {
    expect(() => {
      assertSingleFile(relative);
    }).toThrow(CrossSpeciesScanError);
  });

  it('refuses a cross-species path through the release source', async () => {
    if (!database) throw new Error('DuckDB did not start');
    await expect(nodeSource(database).relation('tables/feature/*.parquet')).rejects.toThrow(
      CrossSpeciesScanError,
    );
  });
});

describe('literals', () => {
  it('escapes quotes', () => {
    expect(sqlString("aac(6')-Ib")).toBe("'aac(6'')-Ib'");
  });
});
