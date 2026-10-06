// Requirements §6.1 (Data, Acceptance) and checklist C1, C5 against the
// synthetic release with the engine the browser runs: the five counters of
// the whole release equal the summary counts, and for a filtered set they
// equal a direct count over tables/genome.parquet; the genome table pages by
// 50 in DuckDB, deterministically, and sorts by its columns with genome_id as
// the tiebreak.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { genomePageSql, genomeRow } from '../src/collection/genomeTable';
import type { TableSort } from '../src/collection/genomeTable';
import { createSetEngine } from '../src/data/setEngine';
import type { SetEngine } from '../src/data/setEngine';
import type { GenomeFilters } from '../src/set/filters';
import {
  type ExtensionRepository,
  type NodeDatabase,
  openNodeDatabase,
  startExtensionRepository,
} from './support/duckdbNode';
import { nodeSource, parquet, readSynthManifest } from './support/releaseSource';

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

function row(sql: string): Record<string, unknown> {
  if (!database) throw new Error('DuckDB did not start');
  return database.query(sql)[0] ?? {};
}

function numbers(record: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(value)]));
}

describe('counters (C1)', () => {
  it('equal the summary counts for the whole release', async () => {
    const expected = numbers(
      row(
        `SELECT sum(genome_count) AS genomes, count(*) FILTER (WHERE genome_count > 0) AS species, ` +
          `sum(st_count) AS sequenceTypes, sum(amr_hit_count) AS amrHits, ` +
          `sum(plasmid_contig_count) AS plasmidContigs ` +
          `FROM ${parquet('summaries/counts_by_species.parquet')}`,
      ),
    );
    expect(await engine.counters({})).toEqual(expected);
    expect(expected.genomes).toBe(readSynthManifest().genome_count);
  });

  it.each<[string, GenomeFilters, string]>([
    ['one species', { species_code: ['KPN'] }, `species_code = 'KPN'`],
    [
      'a source and a platform',
      { source_type: ['clinical'], platform: ['illumina'] },
      `source_type = 'clinical' AND platform = 'illumina'`,
    ],
    [
      'a QC brush',
      { completeness_min: 98, contamination_max: 1.5 },
      `checkm2_completeness >= 98 AND checkm2_contamination <= 1.5`,
    ],
  ])('equal a direct count over the genome table for %s', async (_name, filters, where) => {
    const expected = numbers(
      row(
        `SELECT count(*) AS genomes, count(DISTINCT species_code) AS species, ` +
          `count(DISTINCT species_code || ':' || st) AS sequenceTypes, ` +
          `coalesce(sum(amr_gene_count), 0) AS amrHits, ` +
          `coalesce(sum(plasmid_contig_count), 0) AS plasmidContigs ` +
          `FROM ${parquet('tables/genome.parquet')} WHERE ${where}`,
      ),
    );
    expect(await engine.counters(filters)).toEqual(expected);
  });
});

async function page(filters: GenomeFilters, sort: TableSort | undefined, index: number) {
  const rows = await engine.aggregate(filters, (context) => genomePageSql(context, sort, index));
  return rows.map(genomeRow);
}

describe('genome table (C5)', () => {
  it('pages the whole release by 50 without repeats', async () => {
    const first = await page({}, undefined, 0);
    const second = await page({}, undefined, 1);
    const third = await page({}, undefined, 2);
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(50);
    expect(third).toHaveLength(0);
    const ids = [...first, ...second].map((genome) => genome.genome_id);
    expect(new Set(ids).size).toBe(100);
    expect(ids).toEqual([...ids].sort());
    expect(first[0]).toMatchObject({
      genome_id: 'ABA0001',
      canonical_name: 'Acinetobacter baumannii',
    });
  });

  it('sorts with nulls last and genome_id as the tiebreak', async () => {
    const rows = [...(await page({ species_code: ['KPN'] }, { id: 'st', desc: false }, 0))];
    expect(rows).toHaveLength(28);
    const sts = rows.map((genome) => genome.st);
    expect(sts.at(-1)).toBeNull();
    const typed = sts.filter((st): st is string => st !== null).map(Number);
    expect(typed).toEqual([...typed].sort((a, b) => a - b));
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      if (previous?.st === current?.st) {
        expect((previous?.genome_id ?? '') < (current?.genome_id ?? '')).toBe(true);
      }
    }
  });

  it('sorts descending by a count and reads the chooser columns', async () => {
    const rows = await page({}, { id: 'amr_gene_count', desc: true }, 0);
    const counts = rows.map((genome) => genome.amr_gene_count ?? 0);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const top = rows[0];
    expect(typeof top?.genome_size).toBe('number');
    expect(typeof top?.n50).toBe('number');
    expect(typeof top?.contig_count).toBe('number');
    expect(typeof top?.gc_content).toBe('number');
  });

  it('sorts species by canonical name', async () => {
    const rows = await page(
      { species_code: ['ECO', 'EHO', 'EFM'] },
      { id: 'species_code', desc: false },
      0,
    );
    const names = rows.map((genome) => genome.canonical_name);
    expect([...new Set(names)]).toEqual([
      'Enterobacter hormaechei',
      'Enterococcus faecium',
      'Escherichia coli',
    ]);
  });
});
