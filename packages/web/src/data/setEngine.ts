// The set engine: counts and aggregates for any genome set (requirements
// §5.2, §6.1 Data, §9; data contract §6.2, §7.5).
//
// The whole release, which is also the first render, is described by the
// manifest and the species-grain summaries (summaries/counts_by_* and
// amr_class_by_species). Any other set is aggregated in the browser over the
// genome-grain files: tables/genome.parquet projected into the in-memory
// table `genome_facts` (which also holds the assembly statistics the
// collection table shows), summaries/amr_class_by_genome.parquet, the presence
// files, tables/mutation.parquet and tables/genome_set_member.parquet. No
// per-species table is read here.
//
// The in-memory tables are created once per engine, on the first request
// that needs them; the engine is created once per manifest (see
// ./setEngineContext.ts). The whole-release count never opens the database.
// The Mobile elements facet of the whole release reads plasmid_genome_count
// and prophage_genome_count of summaries/counts_by_species (contract 0.10
// §6.2), and of any other set counts the genomes of genome_facts.
// The species attributes (summaries/counts_by_species) and the CheckM2 points
// (summaries/qc) are copied into memory as well, so that a filter change runs
// its aggregates without reading a release file again (requirements §6.1, C4).
import { palette } from '../generated/palette';
import { filtersKey, isWholeRelease } from '../set/filters';
import type { FilterKey, GenomeFilters } from '../set/filters';
import { fieldAvailable } from '../set/fields';
import { buildPredicate, clusterSpecies } from '../set/predicate';
import type { PredicateSources, PresenceSource } from '../set/predicate';
import type { Manifest } from './manifest';
import { sqlString } from './release';
import type { QueryPriority, ReleaseSource, Row } from './release';
import { readSearchRows } from './searchIndex';
import type { SearchRow } from './searchIndex';

/** Release paths the engine reads (contract §6.1, §6.2). */
export const RELEASE_FILES = {
  genome: 'tables/genome.parquet',
  mutation: 'tables/mutation.parquet',
  setMember: 'tables/genome_set_member.parquet',
  countsBySpecies: 'summaries/counts_by_species.parquet',
  countsBySpeciesYear: 'summaries/counts_by_species_year.parquet',
  countsBySpeciesSt: 'summaries/counts_by_species_st.parquet',
  countsBySource: 'summaries/counts_by_source.parquet',
  countsByPlatform: 'summaries/counts_by_platform.parquet',
  amrClassBySpecies: 'summaries/amr_class_by_species.parquet',
  amrClassByGenome: 'summaries/amr_class_by_genome.parquet',
  qc: 'summaries/qc.parquet',
  searchIndex: 'summaries/search_index.parquet',
  presenceAmr: 'presence_amr.parquet',
  presenceMob: 'presence_mob.parquet',
  presenceReplicon: 'presence_replicon.parquet',
} as const;

export function presenceClusterFile(speciesCode: string): string {
  return `presence/${speciesCode}.parquet`;
}

/** In-memory tables the engine creates. */
export const ENGINE_TABLES = {
  genomeFacts: 'genome_facts',
  amrClass: 'set_amr_class',
  mutation: 'set_mutation',
  setMember: 'set_member',
  species: 'set_species',
  qc: 'set_qc',
} as const;

// Rows of the species-grain summaries (contract §6.2), also produced for a
// filtered set over the genome-grain files.

export interface SpeciesCountRow {
  species_code: string;
  canonical_name: string;
  color: string;
  genome_count: number;
  complete_count: number;
  st_count: number;
  amr_hit_count: number;
  plasmid_contig_count: number;
  /** Genomes with plasmid_contig_count above zero (contract 0.10 §6.2). */
  plasmid_genome_count: number;
  /** Genomes with prophage_region_count above zero (contract 0.10 §6.2). */
  prophage_genome_count: number;
}

export interface SpeciesYearRow {
  species_code: string;
  year: number | null;
  genome_count: number;
}

export interface SpeciesStRow {
  species_code: string;
  mlst_scheme: string | null;
  st: string | null;
  genome_count: number;
}

export interface SourceCountRow {
  species_code: string;
  source_type: string | null;
  country: string | null;
  genome_count: number;
}

export interface PlatformCountRow {
  species_code: string;
  platform: string | null;
  assembly_status: string | null;
  genome_count: number;
}

export interface AmrClassRow {
  species_code: string;
  drug_class: string;
  genome_count: number;
  fraction: number;
  hit_count: number;
}

export interface QcPoint {
  genome_id: string;
  species_code: string;
  completeness: number | null;
  contamination: number | null;
  flag: string;
}

/** The species-grain view of a set, one field per summary file. */
export interface SetSummary {
  bySpecies: SpeciesCountRow[];
  bySpeciesYear: SpeciesYearRow[];
  bySpeciesSt: SpeciesStRow[];
  bySource: SourceCountRow[];
  byPlatform: PlatformCountRow[];
  amrClassBySpecies: AmrClassRow[];
}

/** The five counters of the collection page (requirements §6.1). */
export interface SetCounters {
  genomes: number;
  species: number;
  sequenceTypes: number;
  amrHits: number;
  plasmidContigs: number;
}

export function countersOf(bySpecies: readonly SpeciesCountRow[]): SetCounters {
  const sum = (pick: (row: SpeciesCountRow) => number) =>
    bySpecies.reduce((total, row) => total + pick(row), 0);
  return {
    genomes: sum((row) => row.genome_count),
    species: bySpecies.filter((row) => row.genome_count > 0).length,
    sequenceTypes: sum((row) => row.st_count),
    amrHits: sum((row) => row.amr_hit_count),
    plasmidContigs: sum((row) => row.plasmid_contig_count),
  };
}

/** Genomes of a set carrying a plasmid contig and a prophage region. */
export interface MobileCounts {
  plasmidContig: number;
  prophage: number;
}

/** The mobile element counts of a set from its species-grain rows. */
export function mobileCountsOf(bySpecies: readonly SpeciesCountRow[]): MobileCounts {
  return {
    plasmidContig: bySpecies.reduce((total, row) => total + row.plasmid_genome_count, 0),
    prophage: bySpecies.reduce((total, row) => total + row.prophage_genome_count, 0),
  };
}

export interface FilterOption {
  value: string;
  /** Genomes of the release with the value, when cheap to know. */
  count?: number;
}

/** What the SQL of `aggregate` can refer to. */
export interface AggregateContext {
  /** A parenthesized subquery of the set's rows of genome_facts. */
  set: string;
  /** The predicate over `genome_facts AS g`. */
  where: string;
  tables: typeof ENGINE_TABLES;
  /** The relation of a release file (registered on first use). */
  relation: (path: string) => Promise<string>;
}

export type AggregateBuilder = (context: AggregateContext) => string | Promise<string>;

export interface SetEngine {
  /** Genomes in the set; the manifest count for the whole release. */
  countSet(filters: GenomeFilters): Promise<number>;
  /** The set's genome identifiers, sorted. */
  setGenomeIds(filters: GenomeFilters): Promise<string[]>;
  /** The species codes present in the set, sorted. */
  setSpecies(filters: GenomeFilters): Promise<string[]>;
  /**
   * Any aggregate over the set, from SQL built against the context; a view
   * that renders behind the facet rail asks at low priority.
   */
  aggregate<T = Row>(
    filters: GenomeFilters,
    build: AggregateBuilder,
    priority?: QueryPriority,
  ): Promise<T[]>;
  /** The species-grain summaries of the release, loaded once. */
  releaseSummaries(): Promise<SetSummary>;
  /** The species-grain view of a set: summaries for the whole release, else genome grain. */
  summarize(filters: GenomeFilters): Promise<SetSummary>;
  /** The five counters of a set, from `summarize`. */
  counters(filters: GenomeFilters): Promise<SetCounters>;
  /**
   * Genomes with a plasmid contig and with a prophage region: the species
   * summary for the whole release, else genome grain.
   */
  mobileCounts(filters: GenomeFilters): Promise<MobileCounts>;
  /** CheckM2 points of a set (summaries/qc.parquet). */
  qcPoints(filters: GenomeFilters, priority?: QueryPriority): Promise<QcPoint[]>;
  /** Values offered by the "add filter" menu for a field. */
  filterOptions(key: FilterKey): Promise<FilterOption[]>;
  /** Whether a field can be evaluated on this release. */
  fieldAvailable(key: FilterKey): boolean;
  /** The rows of summaries/search_index.parquet, loaded once. */
  searchRows(): Promise<SearchRow[]>;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

function speciesCountRow(row: Row): SpeciesCountRow {
  return {
    species_code: text(row.species_code),
    canonical_name: text(row.canonical_name),
    color: text(row.color),
    genome_count: num(row.genome_count),
    complete_count: num(row.complete_count),
    st_count: num(row.st_count),
    amr_hit_count: num(row.amr_hit_count),
    plasmid_contig_count: num(row.plasmid_contig_count),
    plasmid_genome_count: num(row.plasmid_genome_count),
    prophage_genome_count: num(row.prophage_genome_count),
  };
}

function speciesYearRow(row: Row): SpeciesYearRow {
  return {
    species_code: text(row.species_code),
    year: numOrNull(row.year),
    genome_count: num(row.genome_count),
  };
}

function speciesStRow(row: Row): SpeciesStRow {
  return {
    species_code: text(row.species_code),
    mlst_scheme: textOrNull(row.mlst_scheme),
    st: textOrNull(row.st),
    genome_count: num(row.genome_count),
  };
}

function sourceRow(row: Row): SourceCountRow {
  return {
    species_code: text(row.species_code),
    source_type: textOrNull(row.source_type),
    country: textOrNull(row.country),
    genome_count: num(row.genome_count),
  };
}

function platformRow(row: Row): PlatformCountRow {
  return {
    species_code: text(row.species_code),
    platform: textOrNull(row.platform),
    assembly_status: textOrNull(row.assembly_status),
    genome_count: num(row.genome_count),
  };
}

function amrClassRow(row: Row): AmrClassRow {
  return {
    species_code: text(row.species_code),
    drug_class: text(row.drug_class),
    genome_count: num(row.genome_count),
    fraction: num(row.fraction),
    hit_count: num(row.hit_count),
  };
}

function qcPoint(row: Row): QcPoint {
  return {
    genome_id: text(row.genome_id),
    species_code: text(row.species_code),
    completeness: numOrNull(row.completeness),
    contamination: numOrNull(row.contamination),
    flag: text(row.flag),
  };
}

/** The statements that create the engine's in-memory tables. */
export function setupStatements(
  relations: {
    genome: string;
    amrClassByGenome?: string | undefined;
    mutation?: string | undefined;
    setMember?: string | undefined;
    countsBySpecies?: string | undefined;
    qc?: string | undefined;
  },
  tables = ENGINE_TABLES,
): string[] {
  const statements = [
    `CREATE OR REPLACE TABLE ${tables.genomeFacts} AS SELECT genome_id, species_code, st, ` +
      `mlst_scheme, source_type, country, CAST(year(isolation_date) AS INTEGER) AS year, ` +
      `platform, assembly_status, checkm2_completeness, checkm2_contamination, ` +
      `amr_gene_count, amr_mutation_count, plasmid_contig_count, prophage_region_count, ` +
      `genome_size, contig_count, n50, gc_content ` +
      `FROM ${relations.genome}`,
  ];
  const empty = (columns: string) => `SELECT ${columns} WHERE FALSE`;
  statements.push(
    `CREATE OR REPLACE TABLE ${tables.amrClass} AS ` +
      (relations.amrClassByGenome !== undefined
        ? `SELECT genome_id, species_code, drug_class, hit_count FROM ${relations.amrClassByGenome}`
        : empty(
            `NULL::VARCHAR AS genome_id, NULL::VARCHAR AS species_code, NULL::VARCHAR AS drug_class, NULL::INTEGER AS hit_count`,
          )),
    `CREATE OR REPLACE TABLE ${tables.mutation} AS ` +
      (relations.mutation !== undefined
        ? `SELECT DISTINCT genome_id, gene, variant FROM ${relations.mutation}`
        : empty(`NULL::VARCHAR AS genome_id, NULL::VARCHAR AS gene, NULL::VARCHAR AS variant`)),
    `CREATE OR REPLACE TABLE ${tables.setMember} AS ` +
      (relations.setMember !== undefined
        ? `SELECT DISTINCT set_id, genome_id FROM ${relations.setMember}`
        : empty(`NULL::VARCHAR AS set_id, NULL::VARCHAR AS genome_id`)),
    `CREATE OR REPLACE TABLE ${tables.species} AS ` +
      (relations.countsBySpecies !== undefined
        ? `SELECT species_code, canonical_name, color FROM ${relations.countsBySpecies}`
        : empty(
            `NULL::VARCHAR AS species_code, NULL::VARCHAR AS canonical_name, NULL::VARCHAR AS color`,
          )),
    `CREATE OR REPLACE TABLE ${tables.qc} AS ` +
      (relations.qc !== undefined
        ? `SELECT * FROM ${relations.qc}`
        : empty(
            `NULL::VARCHAR AS genome_id, NULL::VARCHAR AS species_code, NULL::FLOAT AS completeness, ` +
              `NULL::FLOAT AS contamination, NULL::VARCHAR AS flag`,
          )),
  );
  return statements;
}

/** The set as a subquery of genome_facts rows. */
export function setRelation(where: string, tables = ENGINE_TABLES): string {
  return `(SELECT g.* FROM ${tables.genomeFacts} AS g WHERE ${where})`;
}

/** The parts of the species-grain view of a set, in the `part` column. */
const SUMMARY_PARTS = {
  bySpecies: 'species',
  bySpeciesYear: 'year',
  bySpeciesSt: 'st',
  bySource: 'source',
  byPlatform: 'platform',
  amrClassBySpecies: 'amr_class',
} as const;

/**
 * The species-grain view of a set (contract §6.2 column lists) in one
 * statement over genome_facts and set_amr_class, so that a filter change
 * costs one round trip to the database (requirements §6.1, checklist C4).
 * Each part selects its own columns, `UNION ALL BY NAME` leaves the others
 * null, and the order is that of each summary file within its part.
 * `speciesAttributes` is a relation with species_code, canonical_name and
 * color.
 */
export function summaryQuery(set: string, speciesAttributes: string, tables = ENGINE_TABLES) {
  const part = (key: keyof typeof SUMMARY_PARTS) => `'${SUMMARY_PARTS[key]}' AS part`;
  const count = `CAST(count(*) AS INTEGER) AS genome_count`;
  return (
    `WITH s AS MATERIALIZED ${set}, ` +
    `n AS (SELECT species_code, count(*) AS genomes FROM s GROUP BY 1) ` +
    `SELECT ${part('bySpecies')}, s.species_code, a.canonical_name, a.color, ${count}, ` +
    `CAST(count(*) FILTER (WHERE s.assembly_status = 'complete') AS INTEGER) AS complete_count, ` +
    `CAST(count(DISTINCT s.st) AS INTEGER) AS st_count, ` +
    `CAST(coalesce(sum(s.amr_gene_count), 0) AS BIGINT) AS amr_hit_count, ` +
    `CAST(coalesce(sum(s.plasmid_contig_count), 0) AS BIGINT) AS plasmid_contig_count, ` +
    `CAST(count(*) FILTER (WHERE s.plasmid_contig_count > 0) AS INTEGER) AS plasmid_genome_count, ` +
    `CAST(count(*) FILTER (WHERE s.prophage_region_count > 0) AS INTEGER) AS prophage_genome_count ` +
    `FROM s LEFT JOIN ${speciesAttributes} AS a USING (species_code) ` +
    `GROUP BY s.species_code, a.canonical_name, a.color ` +
    `UNION ALL BY NAME ` +
    `SELECT ${part('bySpeciesYear')}, species_code, year, ${count} FROM s GROUP BY ALL ` +
    `UNION ALL BY NAME ` +
    `SELECT ${part('bySpeciesSt')}, species_code, mlst_scheme, st, ${count} FROM s GROUP BY ALL ` +
    `UNION ALL BY NAME ` +
    `SELECT ${part('bySource')}, species_code, source_type, country, ${count} FROM s GROUP BY ALL ` +
    `UNION ALL BY NAME ` +
    `SELECT ${part('byPlatform')}, species_code, platform, assembly_status, ${count} ` +
    `FROM s GROUP BY ALL ` +
    `UNION ALL BY NAME ` +
    `SELECT ${part('amrClassBySpecies')}, c.species_code, c.drug_class, ` +
    `CAST(count(DISTINCT c.genome_id) AS INTEGER) AS genome_count, ` +
    `CAST(count(DISTINCT c.genome_id) AS DOUBLE) / any_value(n.genomes) AS fraction, ` +
    `CAST(sum(c.hit_count) AS BIGINT) AS hit_count ` +
    `FROM ${tables.amrClass} AS c JOIN s USING (genome_id) JOIN n ON n.species_code = c.species_code ` +
    `GROUP BY c.species_code, c.drug_class ` +
    `ORDER BY part, species_code, year NULLS LAST, mlst_scheme NULLS LAST, st NULLS LAST, ` +
    `source_type NULLS LAST, country NULLS LAST, platform NULLS LAST, assembly_status NULLS LAST, ` +
    `drug_class`
  );
}

/** The rows of `summaryQuery`, split into the six summaries. */
export function splitSummary(rows: readonly Row[]): SetSummary {
  const of = (key: keyof typeof SUMMARY_PARTS) =>
    rows.filter((row) => row.part === SUMMARY_PARTS[key]);
  return {
    bySpecies: of('bySpecies').map(speciesCountRow),
    bySpeciesYear: of('bySpeciesYear').map(speciesYearRow),
    bySpeciesSt: of('bySpeciesSt').map(speciesStRow),
    bySource: of('bySource').map(sourceRow),
    byPlatform: of('byPlatform').map(platformRow),
    amrClassBySpecies: of('amrClassBySpecies').map(amrClassRow),
  };
}

const LIST_COLUMNS: Partial<Record<FilterKey, string>> = {
  st: 'st',
  source_type: 'source_type',
  country: 'country',
  platform: 'platform',
  assembly_status: 'assembly_status',
};

const CACHE_LIMIT = 64;

/** A small map that forgets its oldest entries. */
class Memo<T> {
  private readonly entries = new Map<string, Promise<T>>();

  get(key: string, make: () => Promise<T>): Promise<T> {
    const known = this.entries.get(key);
    if (known !== undefined) return known;
    const value = make();
    this.entries.set(key, value);
    value.catch(() => this.entries.delete(key));
    if (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return value;
  }
}

async function describeColumns(source: ReleaseSource, relation: string): Promise<Set<string>> {
  const rows = await source.query(`DESCRIBE SELECT * FROM ${relation}`);
  const names = rows.map((row) => text(row.column_name));
  return new Set(names.filter((name) => name !== 'genome_id' && name !== 'species_code'));
}

/** A set engine over a release source and its manifest. */
export function createSetEngine(source: ReleaseSource, manifest: Manifest): SetEngine {
  const presence = new Map<string, Promise<PresenceSource | undefined>>();
  const presenceOf = (path: string): Promise<PresenceSource | undefined> => {
    let known = presence.get(path);
    if (known === undefined) {
      known = source.has(path)
        ? source.relation(path).then(async (relation) => ({
            relation,
            columns: await describeColumns(source, relation),
          }))
        : Promise.resolve(undefined);
      presence.set(path, known);
      known.catch(() => presence.delete(path));
    }
    return known;
  };
  const optional = (path: string) =>
    source.has(path) ? source.relation(path) : Promise.resolve(undefined);

  let ready: Promise<void> | undefined;
  const setup = (): Promise<void> => {
    ready ??= (async () => {
      const [genome, amrClassByGenome, mutation, setMember, countsBySpecies, qc] =
        await Promise.all([
          source.relation(RELEASE_FILES.genome),
          optional(RELEASE_FILES.amrClassByGenome),
          optional(RELEASE_FILES.mutation),
          optional(RELEASE_FILES.setMember),
          optional(RELEASE_FILES.countsBySpecies),
          optional(RELEASE_FILES.qc),
        ]);
      const relations = { genome, amrClassByGenome, mutation, setMember, countsBySpecies, qc };
      for (const statement of setupStatements(relations)) {
        await source.query(statement);
      }
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };

  const predicateSources = async (filters: GenomeFilters): Promise<PredicateSources> => {
    const clusterSpeciesCodes = [
      ...new Set((filters.cluster ?? []).map(clusterSpecies).filter((code) => code !== undefined)),
    ];
    const [presenceAmr, presenceMob, presenceReplicon, ...clusterFiles] = await Promise.all([
      filters.presence_amr ? presenceOf(RELEASE_FILES.presenceAmr) : undefined,
      filters.presence_mob ? presenceOf(RELEASE_FILES.presenceMob) : undefined,
      filters.replicon ? presenceOf(RELEASE_FILES.presenceReplicon) : undefined,
      ...clusterSpeciesCodes.map((code) => presenceOf(presenceClusterFile(code))),
    ]);
    const clusters = new Map(clusterSpeciesCodes.map((code, i) => [code, clusterFiles[i]]));
    return {
      amrClass: source.has(RELEASE_FILES.amrClassByGenome) ? ENGINE_TABLES.amrClass : undefined,
      mutation: source.has(RELEASE_FILES.mutation) ? ENGINE_TABLES.mutation : undefined,
      setMember: source.has(RELEASE_FILES.setMember) ? ENGINE_TABLES.setMember : undefined,
      presenceAmr,
      presenceMob,
      presenceReplicon,
      presenceCluster: (code) => clusters.get(code),
    };
  };

  const whereOf = async (filters: GenomeFilters): Promise<string> => {
    await setup();
    return buildPredicate(filters, await predicateSources(filters));
  };

  const aggregate = async <T = Row>(
    filters: GenomeFilters,
    build: AggregateBuilder,
    priority: QueryPriority = 'high',
  ) => {
    const where = await whereOf(filters);
    const sql = await build({
      set: setRelation(where),
      where,
      tables: ENGINE_TABLES,
      relation: (path) => source.relation(path),
    });
    return (await source.query(sql, priority)) as T[];
  };

  const counts = new Memo<number>();
  const summaries = new Memo<SetSummary>();
  let releaseSummaries: Promise<SetSummary> | undefined;
  let searchRows: Promise<SearchRow[]> | undefined;

  const loadReleaseSummaries = (): Promise<SetSummary> => {
    releaseSummaries ??= (async () => {
      const read = async (path: string, order: string) =>
        source.query(`SELECT * FROM ${await source.relation(path)} ORDER BY ${order}`);
      const [bySpecies, bySpeciesYear, bySpeciesSt, bySource, byPlatform, amrClass] =
        await Promise.all([
          read(RELEASE_FILES.countsBySpecies, 'species_code'),
          read(RELEASE_FILES.countsBySpeciesYear, 'species_code, year NULLS LAST'),
          read(
            RELEASE_FILES.countsBySpeciesSt,
            'species_code, mlst_scheme NULLS LAST, st NULLS LAST',
          ),
          read(
            RELEASE_FILES.countsBySource,
            'species_code, source_type NULLS LAST, country NULLS LAST',
          ),
          read(
            RELEASE_FILES.countsByPlatform,
            'species_code, platform NULLS LAST, assembly_status NULLS LAST',
          ),
          read(RELEASE_FILES.amrClassBySpecies, 'species_code, drug_class'),
        ]);
      return {
        bySpecies: bySpecies.map(speciesCountRow),
        bySpeciesYear: bySpeciesYear.map(speciesYearRow),
        bySpeciesSt: bySpeciesSt.map(speciesStRow),
        bySource: bySource.map(sourceRow),
        byPlatform: byPlatform.map(platformRow),
        amrClassBySpecies: amrClass.map(amrClassRow),
      };
    })().catch((error: unknown) => {
      releaseSummaries = undefined;
      throw error;
    });
    return releaseSummaries;
  };

  const summarizeGenomes = async (filters: GenomeFilters): Promise<SetSummary> => {
    const where = await whereOf(filters);
    return splitSummary(
      await source.query(summaryQuery(setRelation(where), ENGINE_TABLES.species)),
    );
  };

  const engine: SetEngine & { summarizeGenomes: typeof summarizeGenomes } = {
    countSet: (filters) => {
      if (isWholeRelease(filters)) return Promise.resolve(manifest.genome_count);
      return counts.get(filtersKey(filters), async () => {
        const rows = await aggregate(
          filters,
          ({ set }) => `SELECT CAST(count(*) AS INTEGER) AS n FROM ${set}`,
        );
        return num(rows[0]?.n ?? 0);
      });
    },
    setGenomeIds: async (filters) => {
      const rows = await aggregate(
        filters,
        ({ set }) => `SELECT genome_id FROM ${set} ORDER BY genome_id`,
      );
      return rows.map((row) => text(row.genome_id));
    },
    setSpecies: async (filters) => {
      if (isWholeRelease(filters)) {
        return manifest.species.map((species) => species.species_code).sort();
      }
      const rows = await aggregate(
        filters,
        ({ set }) => `SELECT DISTINCT species_code FROM ${set} ORDER BY species_code`,
      );
      return rows.map((row) => text(row.species_code));
    },
    aggregate,
    releaseSummaries: loadReleaseSummaries,
    summarize: (filters) => {
      if (isWholeRelease(filters)) return loadReleaseSummaries();
      return summaries.get(filtersKey(filters), () => summarizeGenomes(filters));
    },
    counters: async (filters) => countersOf((await engine.summarize(filters)).bySpecies),
    mobileCounts: async (filters) => {
      if (isWholeRelease(filters)) return mobileCountsOf((await loadReleaseSummaries()).bySpecies);
      const rows = await aggregate(
        filters,
        ({ set }) =>
          `SELECT CAST(count(*) FILTER (WHERE plasmid_contig_count > 0) AS INTEGER) AS plasmid, ` +
          `CAST(count(*) FILTER (WHERE prophage_region_count > 0) AS INTEGER) AS prophage FROM ${set}`,
      );
      return { plasmidContig: num(rows[0]?.plasmid ?? 0), prophage: num(rows[0]?.prophage ?? 0) };
    },
    qcPoints: async (filters, priority = 'high') => {
      if (isWholeRelease(filters)) {
        const qc = await source.relation(RELEASE_FILES.qc);
        const rows = await source.query(`SELECT * FROM ${qc} ORDER BY genome_id`, priority);
        return rows.map(qcPoint);
      }
      const rows = await aggregate(
        filters,
        ({ set, tables }) =>
          `SELECT q.* FROM ${tables.qc} AS q ` +
          `WHERE q.genome_id IN (SELECT genome_id FROM ${set}) ORDER BY q.genome_id`,
        priority,
      );
      return rows.map(qcPoint);
    },
    filterOptions: async (key) => {
      switch (key) {
        case 'species_code':
          return manifest.species.map((species) => ({
            value: species.species_code,
            count: species.genome_count,
          }));
        case 'set':
          return manifest.curated_sets.map((set) => ({
            value: set.set_id,
            count: set.genome_count,
          }));
        case 'drug_class':
          return palette.drug_classes.map((drugClass) => ({ value: drugClass.key }));
        case 'presence_amr':
        case 'presence_mob':
        case 'replicon': {
          const file =
            key === 'presence_amr'
              ? RELEASE_FILES.presenceAmr
              : key === 'presence_mob'
                ? RELEASE_FILES.presenceMob
                : RELEASE_FILES.presenceReplicon;
          const found = await presenceOf(file);
          return [...(found?.columns ?? [])].map((value) => ({ value }));
        }
        case 'mutation': {
          await setup();
          const rows = await source.query(
            `SELECT gene || '_' || variant AS value, CAST(count(DISTINCT genome_id) AS INTEGER) AS n ` +
              `FROM ${ENGINE_TABLES.mutation} WHERE gene IS NOT NULL AND variant IS NOT NULL ` +
              `GROUP BY 1 ORDER BY 1`,
          );
          return rows.map((row) => ({ value: text(row.value), count: num(row.n) }));
        }
        default: {
          const column = LIST_COLUMNS[key];
          if (column === undefined) return [];
          await setup();
          const rows = await source.query(
            `SELECT ${column} AS value, CAST(count(*) AS INTEGER) AS n FROM ${ENGINE_TABLES.genomeFacts} ` +
              `WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY 1`,
          );
          return rows.map((row) => ({ value: text(row.value), count: num(row.n) }));
        }
      }
    },
    fieldAvailable: (key) => fieldAvailable(manifest, key),
    searchRows: () => {
      searchRows ??= (async () => {
        const relation = await source.relation(RELEASE_FILES.searchIndex);
        return readSearchRows(
          await source.query(
            `SELECT term, kind, target, species_code, CAST(count AS INTEGER) AS count FROM ${relation}`,
          ),
        );
      })().catch((error: unknown) => {
        searchRows = undefined;
        throw error;
      });
      return searchRows;
    },
    summarizeGenomes,
  };
  return engine;
}

/** The genome-grain summary of a set even for the whole release (tests, C1). */
export function summarizeOverGenomes(
  engine: SetEngine,
  filters: GenomeFilters,
): Promise<SetSummary> {
  const withGenomes = engine as SetEngine & {
    summarizeGenomes?: (filters: GenomeFilters) => Promise<SetSummary>;
  };
  if (withGenomes.summarizeGenomes === undefined) return engine.summarize(filters);
  return withGenomes.summarizeGenomes(filters);
}

/** A SQL list of string literals, for builders passed to `aggregate`. */
export function sqlList(values: readonly string[]): string {
  return values.map(sqlString).join(', ');
}
