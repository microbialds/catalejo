// Pages of genome table rows for component tests (requirements §6.1, §5.3;
// collection/genomeTable.ts): 50 Klebsiella rows per page, numbered from the
// page's offset, and an `aggregate` stub that records the table's SQL and
// answers with the page its OFFSET names.
import type { AggregateBuilder } from '../../src/data/setEngine';
import { ENGINE_TABLES } from '../../src/data/setEngine';
import { palette } from '../../src/generated/palette';
import type { GenomeFilters } from '../../src/set/filters';

export function genomeRows(page: number) {
  return Array.from({ length: 50 }, (_, i) => {
    const n = page * 50 + i + 1;
    return {
      genome_id: `KPN${String(n).padStart(4, '0')}`,
      species_code: 'KPN',
      canonical_name: 'Klebsiella pneumoniae',
      color: palette.species.sequence[0],
      st: '258',
      source_type: 'clinical',
      year: 2019,
      amr_gene_count: 3,
      plasmid_contig_count: 1,
      checkm2_completeness: 99.12,
      country: 'CL',
      platform: 'illumina',
      assembly_status: 'draft',
      checkm2_contamination: 0.5,
      genome_size: 5_400_000,
      contig_count: 80,
      n50: 250_000,
      gc_content: 57.1,
    };
  });
}

/** An engine `aggregate` answering the table's page queries; SQL goes to `sql`. */
export function tableAggregate(sql: string[] = []) {
  return async <T>(_filters: GenomeFilters, build: AggregateBuilder): Promise<T[]> => {
    const text = await build({
      set: '(SET)',
      where: 'TRUE',
      tables: ENGINE_TABLES,
      relation: (path) => Promise.resolve(`read_parquet('${path}')`),
    });
    sql.push(text);
    const offset = /OFFSET (\d+)$/.exec(text)?.[1] ?? '0';
    return genomeRows(Number(offset) / 50) as T[];
  };
}
