// Facet values of the collection rail (requirements §6.1; contract §6.2).
// Every facet lists the values the release holds, in a fixed order, with the
// count of genomes of the current set carrying each (zero when the current
// filters exclude it), so that a value can still be added: values within a
// field are alternatives (§5.2).
//
// Species are ordered by their rank in the release; source types,
// platforms and assembly statuses by release count, ties by value; drug
// classes in palette order. Counts come from the species-grain view of the
// set (`summarize`), which is the summaries for the whole release and the
// genome-grain aggregation otherwise.
import type { SetSummary } from '../data/setEngine';
import { compareText } from '../set/filters';
import { drugClassOrder } from '../set/fields';
import { rankSpecies } from './species';

export interface FacetValue {
  value: string;
  count: number;
}

export interface SpeciesFacetValue extends FacetValue {
  name: string;
  color: string;
}

export interface CollectionFacets {
  species: SpeciesFacetValue[];
  sourceType: FacetValue[];
  drugClass: FacetValue[];
  platform: FacetValue[];
  assemblyStatus: FacetValue[];
}

function tally<T>(rows: readonly T[], value: (row: T) => string | null, count: (row: T) => number) {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    if (key === null) continue;
    out.set(key, (out.get(key) ?? 0) + count(row));
  }
  return out;
}

function ordered(release: Map<string, number>, current: Map<string, number>): FacetValue[] {
  return [...release.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .map(([value]) => ({ value, count: current.get(value) ?? 0 }));
}

/** The facet values of the release with the counts of the current set. */
export function collectionFacets(release: SetSummary, current: SetSummary): CollectionFacets {
  const speciesCounts = new Map(current.bySpecies.map((row) => [row.species_code, row]));
  const species = rankSpecies(release.bySpecies).map((row) => ({
    value: row.species_code,
    name: row.canonical_name,
    color: row.color,
    count: speciesCounts.get(row.species_code)?.genome_count ?? 0,
  }));
  const source = (summary: SetSummary) =>
    tally(
      summary.bySource,
      (row) => row.source_type,
      (row) => row.genome_count,
    );
  const platform = (summary: SetSummary) =>
    tally(
      summary.byPlatform,
      (row) => row.platform,
      (row) => row.genome_count,
    );
  const status = (summary: SetSummary) =>
    tally(
      summary.byPlatform,
      (row) => row.assembly_status,
      (row) => row.genome_count,
    );
  // Each genome belongs to one species, so the per-species counts of genomes
  // with a hit in a class add up to the set's genomes with a hit in it.
  const drugClass = (summary: SetSummary) =>
    tally(
      summary.amrClassBySpecies,
      (row) => row.drug_class,
      (row) => row.genome_count,
    );
  const releaseClasses = drugClass(release);
  const currentClasses = drugClass(current);
  return {
    species,
    sourceType: ordered(source(release), source(current)),
    drugClass: [...releaseClasses.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => drugClassOrder(a[0]) - drugClassOrder(b[0]) || compareText(a[0], b[0]))
      .map(([value]) => ({ value, count: currentClasses.get(value) ?? 0 })),
    platform: ordered(platform(release), platform(current)),
    assemblyStatus: ordered(status(release), status(current)),
  };
}

/** Whether a set mixes platforms or assembly statuses (requirements §5.5). */
export function mixesAssemblies(summary: SetSummary): boolean {
  const platforms = new Set<string>();
  const statuses = new Set<string>();
  for (const row of summary.byPlatform) {
    if (row.genome_count <= 0) continue;
    if (row.platform !== null) platforms.add(row.platform);
    if (row.assembly_status !== null) statuses.add(row.assembly_status);
  }
  return platforms.size > 1 || statuses.size > 1;
}
