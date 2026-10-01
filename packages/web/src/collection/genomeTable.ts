// The genome table of the collection page (requirements §6.1; checklist C5;
// collection board, table). Sorting and paging run in DuckDB over the set's
// rows of genome_facts: ORDER BY the sorted column with nulls last and
// genome_id as the tiebreak, so every page is deterministic, then LIMIT 50
// OFFSET. Only the columns listed here can be sorted, so no name from the
// interface state reaches the SQL. Species sort by canonical name, read from
// summaries/counts_by_species.parquet; STs sort numerically when all digits.
import type { AggregateContext } from '../data/setEngine';
import { RELEASE_FILES } from '../data/setEngine';
import { strings } from '../strings';

export const TABLE_PAGE_SIZE = 50;

export type GenomeColumnId =
  | 'genome_id'
  | 'species_code'
  | 'st'
  | 'source_type'
  | 'year'
  | 'amr_gene_count'
  | 'plasmid_contig_count'
  | 'checkm2_completeness'
  | 'country'
  | 'platform'
  | 'assembly_status'
  | 'checkm2_contamination'
  | 'genome_size'
  | 'contig_count'
  | 'n50'
  | 'gc_content';

export interface GenomeColumn {
  id: GenomeColumnId;
  header: string;
  /** Shown by default (the board's columns, without Typing). */
  defaultVisible: boolean;
  /** Numbers are right-aligned in monospace. */
  numeric: boolean;
  /** The ORDER BY expressions over `t` (the set) and `s` (species names). */
  orderBy: readonly string[];
}

export const GENOME_COLUMNS: readonly GenomeColumn[] = [
  {
    id: 'genome_id',
    header: strings.tableColumnGenome,
    defaultVisible: true,
    numeric: false,
    orderBy: ['t.genome_id'],
  },
  {
    id: 'species_code',
    header: strings.tableColumnSpecies,
    defaultVisible: true,
    numeric: false,
    orderBy: ['s.canonical_name'],
  },
  {
    id: 'st',
    header: strings.tableColumnSt,
    defaultVisible: true,
    numeric: false,
    orderBy: ['TRY_CAST(t.st AS BIGINT)', 't.st'],
  },
  {
    id: 'source_type',
    header: strings.tableColumnSource,
    defaultVisible: true,
    numeric: false,
    orderBy: ['t.source_type'],
  },
  {
    id: 'year',
    header: strings.tableColumnYear,
    defaultVisible: true,
    numeric: true,
    orderBy: ['t.year'],
  },
  {
    id: 'amr_gene_count',
    header: strings.tableColumnAmr,
    defaultVisible: true,
    numeric: true,
    orderBy: ['t.amr_gene_count'],
  },
  {
    id: 'plasmid_contig_count',
    header: strings.tableColumnPlasmids,
    defaultVisible: true,
    numeric: true,
    orderBy: ['t.plasmid_contig_count'],
  },
  {
    id: 'checkm2_completeness',
    header: strings.tableColumnCompleteness,
    defaultVisible: true,
    numeric: true,
    orderBy: ['t.checkm2_completeness'],
  },
  {
    id: 'country',
    header: strings.tableColumnCountry,
    defaultVisible: false,
    numeric: false,
    orderBy: ['t.country'],
  },
  {
    id: 'platform',
    header: strings.tableColumnPlatform,
    defaultVisible: false,
    numeric: false,
    orderBy: ['t.platform'],
  },
  {
    id: 'assembly_status',
    header: strings.tableColumnAssemblyStatus,
    defaultVisible: false,
    numeric: false,
    orderBy: ['t.assembly_status'],
  },
  {
    id: 'checkm2_contamination',
    header: strings.tableColumnContamination,
    defaultVisible: false,
    numeric: true,
    orderBy: ['t.checkm2_contamination'],
  },
  {
    id: 'genome_size',
    header: strings.tableColumnGenomeSize,
    defaultVisible: false,
    numeric: true,
    orderBy: ['t.genome_size'],
  },
  {
    id: 'contig_count',
    header: strings.tableColumnContigs,
    defaultVisible: false,
    numeric: true,
    orderBy: ['t.contig_count'],
  },
  {
    id: 'n50',
    header: strings.tableColumnN50,
    defaultVisible: false,
    numeric: true,
    orderBy: ['t.n50'],
  },
  {
    id: 'gc_content',
    header: strings.tableColumnGc,
    defaultVisible: false,
    numeric: true,
    orderBy: ['t.gc_content'],
  },
];

const byId = new Map(GENOME_COLUMNS.map((column) => [column.id, column]));

export function isGenomeColumnId(id: string): id is GenomeColumnId {
  return byId.has(id as GenomeColumnId);
}

export interface TableSort {
  id: string;
  desc: boolean;
}

/** The ORDER BY clause: the sorted column, nulls last, then genome_id. */
export function orderClause(sort: TableSort | undefined): string {
  const column = sort !== undefined && isGenomeColumnId(sort.id) ? byId.get(sort.id) : undefined;
  if (column === undefined || column.id === 'genome_id') {
    return `ORDER BY t.genome_id ${sort?.desc === true ? 'DESC' : 'ASC'}`;
  }
  const direction = sort?.desc === true ? 'DESC' : 'ASC';
  const parts = column.orderBy.map((expression) => `${expression} ${direction} NULLS LAST`);
  return `ORDER BY ${parts.join(', ')}, t.genome_id ASC`;
}

/** One page of the set's genomes, sorted, as SQL over the aggregate context. */
export async function genomePageSql(
  context: Pick<AggregateContext, 'set' | 'relation'>,
  sort: TableSort | undefined,
  pageIndex: number,
): Promise<string> {
  const species = await context.relation(RELEASE_FILES.countsBySpecies);
  const offset = Math.max(0, Math.floor(pageIndex)) * TABLE_PAGE_SIZE;
  return (
    `SELECT t.genome_id, t.species_code, s.canonical_name, s.color, t.st, t.source_type, ` +
    `t.year, t.amr_gene_count, t.plasmid_contig_count, t.checkm2_completeness, t.country, ` +
    `t.platform, t.assembly_status, t.checkm2_contamination, t.genome_size, t.contig_count, ` +
    `t.n50, t.gc_content ` +
    `FROM ${context.set} AS t ` +
    `LEFT JOIN (SELECT species_code, canonical_name, color FROM ${species}) AS s USING (species_code) ` +
    `${orderClause(sort)} LIMIT ${String(TABLE_PAGE_SIZE)} OFFSET ${String(offset)}`
  );
}

export interface GenomeRow {
  genome_id: string;
  species_code: string;
  canonical_name: string | null;
  color: string | null;
  st: string | null;
  source_type: string | null;
  year: number | null;
  amr_gene_count: number | null;
  plasmid_contig_count: number | null;
  checkm2_completeness: number | null;
  country: string | null;
  platform: string | null;
  assembly_status: string | null;
  checkm2_contamination: number | null;
  genome_size: number | null;
  contig_count: number | null;
  n50: number | null;
  gc_content: number | null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function numberOrNull(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

/** A query row as a GenomeRow (BIGINT columns may arrive as bigint). */
export function genomeRow(row: Record<string, unknown>): GenomeRow {
  return {
    genome_id: textOrNull(row.genome_id) ?? '',
    species_code: textOrNull(row.species_code) ?? '',
    canonical_name: textOrNull(row.canonical_name),
    color: textOrNull(row.color),
    st: textOrNull(row.st),
    source_type: textOrNull(row.source_type),
    year: numberOrNull(row.year),
    amr_gene_count: numberOrNull(row.amr_gene_count),
    plasmid_contig_count: numberOrNull(row.plasmid_contig_count),
    checkm2_completeness: numberOrNull(row.checkm2_completeness),
    country: textOrNull(row.country),
    platform: textOrNull(row.platform),
    assembly_status: textOrNull(row.assembly_status),
    checkm2_contamination: numberOrNull(row.checkm2_contamination),
    genome_size: numberOrNull(row.genome_size),
    contig_count: numberOrNull(row.contig_count),
    n50: numberOrNull(row.n50),
    gc_content: numberOrNull(row.gc_content),
  };
}

/** Pages of a set of `count` genomes (at least one). */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
}
