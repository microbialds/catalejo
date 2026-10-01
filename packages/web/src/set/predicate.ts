// The SQL predicate of a genome set (requirements §5.2; data contract §6.2,
// §7.5). Filters are conjunctive across keys and disjunctive within a key. The
// predicate is evaluated over the in-memory genome view (`genome_facts`, see
// data/setEngine.ts) under an alias, and reaches the genome-grain files
// through semi-joins:
//
// - presence_amr, presence_mob and replicon read the BOOLEAN columns of
//   presence_amr.parquet, presence_mob.parquet and presence_replicon.parquet;
// - cluster reads presence/<species_code>.parquet, the species being the
//   prefix of the cluster identifier (contract §3.5);
// - drug_class reads amr_class_by_genome, mutation reads mutation
//   (`gene || '_' || variant`), set reads genome_set_member.
//
// Every value is written as an escaped literal and every column name as a
// quoted identifier. A name the file does not have, or a file the release
// does not include, makes its alternative false, so a stale URL selects no
// genome instead of failing.
import { sqlIdentifier, sqlString } from '../data/release';
import { canonicalFilters } from './filters';
import type { GenomeFilters } from './filters';

/** A wide presence file: its relation and its BOOLEAN column names. */
export interface PresenceSource {
  relation: string;
  columns: ReadonlySet<string>;
}

export interface PredicateSources {
  /** Relation with genome_id, drug_class (amr_class_by_genome). */
  amrClass?: string | undefined;
  /** Relation with genome_id, gene, variant (mutation). */
  mutation?: string | undefined;
  /** Relation with set_id, genome_id (genome_set_member). */
  setMember?: string | undefined;
  presenceAmr?: PresenceSource | undefined;
  presenceMob?: PresenceSource | undefined;
  presenceReplicon?: PresenceSource | undefined;
  /** The pangenome presence file of a species, when the release has one. */
  presenceCluster?: ((speciesCode: string) => PresenceSource | undefined) | undefined;
}

const FALSE = 'FALSE';
const TRUE = 'TRUE';

function list(values: readonly string[]): string {
  return values.map(sqlString).join(', ');
}

function inList(column: string, values: readonly string[]): string {
  return `${column} IN (${list(values)})`;
}

function finite(value: number): string {
  // String() of a finite number is a valid DuckDB numeric literal (1e-7 too).
  return String(value);
}

function presence(alias: string, source: PresenceSource | undefined, names: readonly string[]) {
  if (source === undefined) return FALSE;
  const known = names.filter((name) => source.columns.has(name));
  if (known.length === 0) return FALSE;
  const any = known.map(sqlIdentifier).join(' OR ');
  return `${alias}.genome_id IN (SELECT genome_id FROM ${source.relation} WHERE ${any})`;
}

/** The species code of a pangenome cluster identifier (contract §3.5). */
export function clusterSpecies(clusterId: string): string | undefined {
  const match = /^([A-Z]{3,5})\./.exec(clusterId);
  return match?.[1];
}

function clusters(alias: string, sources: PredicateSources, ids: readonly string[]): string {
  const bySpecies = new Map<string, string[]>();
  for (const id of ids) {
    const species = clusterSpecies(id);
    if (species === undefined) continue;
    bySpecies.set(species, [...(bySpecies.get(species) ?? []), id]);
  }
  const parts = [...bySpecies]
    .map(([species, names]) => presence(alias, sources.presenceCluster?.(species), names))
    .filter((part) => part !== FALSE);
  if (parts.length === 0) return FALSE;
  return parts.length === 1 ? (parts[0] ?? FALSE) : `(${parts.join(' OR ')})`;
}

function semiJoin(alias: string, relation: string | undefined, condition: string): string {
  if (relation === undefined) return FALSE;
  return `${alias}.genome_id IN (SELECT genome_id FROM ${relation} WHERE ${condition})`;
}

/**
 * The WHERE predicate of a set over `genome_facts AS <alias>`. Returns "TRUE"
 * for the whole release.
 */
export function buildPredicate(
  filters: GenomeFilters,
  sources: PredicateSources,
  alias = 'g',
): string {
  const f = canonicalFilters(filters);
  const a = alias;
  const terms: string[] = [];
  const column = (name: string) => `${a}.${name}`;

  if (f.species_code) terms.push(inList(column('species_code'), f.species_code));
  if (f.st) terms.push(inList(column('st'), f.st));
  if (f.source_type) terms.push(inList(column('source_type'), f.source_type));
  if (f.country) terms.push(inList(column('country'), f.country));
  if (f.year) {
    // A genome without an isolation date fails a year filter (contract §7.5).
    const parts = [`${column('year')} IS NOT NULL`];
    if (f.year.min !== undefined) parts.push(`${column('year')} >= ${finite(f.year.min)}`);
    if (f.year.max !== undefined) parts.push(`${column('year')} <= ${finite(f.year.max)}`);
    terms.push(`(${parts.join(' AND ')})`);
  }
  if (f.platform) terms.push(inList(column('platform'), f.platform));
  if (f.assembly_status) terms.push(inList(column('assembly_status'), f.assembly_status));
  // CheckM2 values are FLOAT; the bound is cast to FLOAT so that a bound read
  // off a value (a brush end, a table cell) includes that value.
  if (f.completeness_min !== undefined) {
    terms.push(`${column('checkm2_completeness')} >= CAST(${finite(f.completeness_min)} AS FLOAT)`);
  }
  if (f.contamination_max !== undefined) {
    terms.push(
      `${column('checkm2_contamination')} <= CAST(${finite(f.contamination_max)} AS FLOAT)`,
    );
  }
  if (f.presence_amr) terms.push(presence(a, sources.presenceAmr, f.presence_amr));
  if (f.drug_class) {
    terms.push(semiJoin(a, sources.amrClass, inList('drug_class', f.drug_class)));
  }
  if (f.mutation) {
    terms.push(semiJoin(a, sources.mutation, inList(`(gene || '_' || variant)`, f.mutation)));
  }
  if (f.replicon) terms.push(presence(a, sources.presenceReplicon, f.replicon));
  if (f.plasmid_contig) terms.push(`${column('plasmid_contig_count')} > 0`);
  if (f.presence_mob) terms.push(presence(a, sources.presenceMob, f.presence_mob));
  if (f.prophage) terms.push(`${column('prophage_region_count')} > 0`);
  if (f.cluster) terms.push(clusters(a, sources, f.cluster));
  if (f.set) terms.push(semiJoin(a, sources.setMember, inList('set_id', f.set)));
  if (f.genome_id) terms.push(inList(column('genome_id'), f.genome_id));

  if (terms.length === 0) return TRUE;
  return terms.join(' AND ');
}
