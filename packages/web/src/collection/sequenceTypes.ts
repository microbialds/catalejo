// Sequence types panel (requirements §6.1; checklist C8; collection board).
// The panel shows the STs of one species: the single value of the species
// filter when there is exactly one, else the largest species of the set
// (ranked as in ./species.ts). The top TOP_STS sequence types are drawn as
// bars and the remaining typed genomes as one "other" bar; genomes without
// an ST are counted in a footnote. A species none of whose genomes has an
// ST (no MLST scheme, as Serratia marcescens in the synthetic release) shows
// a statement instead of bars.
import type { SpeciesStRow } from '../data/setEngine';
import type { GenomeFilters } from '../set/filters';
import { compareText, withKey } from '../set/filters';
import { rankSpecies } from './species';

export const TOP_STS = 5;

/** The species whose STs the panel shows, or undefined for an empty set. */
export function stPanelSpecies(
  filters: GenomeFilters,
  bySpecies: readonly { species_code: string; genome_count: number }[],
): string | undefined {
  const chosen = filters.species_code;
  if (chosen?.length === 1) return chosen[0];
  return rankSpecies(bySpecies)[0]?.species_code;
}

export interface StBar {
  /** The ST values the bar stands for: one, or several for "other". */
  values: string[];
  isOther: boolean;
  genomeCount: number;
}

export interface StPanel {
  /** No genome of the species has an ST. */
  noScheme: boolean;
  bars: StBar[];
  /** Genomes of the species without an ST. */
  untyped: number;
}

/** Numeric order for all-digit STs, then text order. */
export function compareSt(a: string, b: string): number {
  const digits = /^\d+$/;
  const aNum = digits.test(a);
  const bNum = digits.test(b);
  if (aNum && bNum) return Number(a) - Number(b) || compareText(a, b);
  if (aNum) return -1;
  if (bNum) return 1;
  return compareText(a, b);
}

/** The bars of one species from the set's species × ST counts. */
export function stPanel(rows: readonly SpeciesStRow[], speciesCode: string): StPanel {
  const typed = new Map<string, number>();
  let untyped = 0;
  for (const row of rows) {
    if (row.species_code !== speciesCode) continue;
    if (row.st === null) untyped += row.genome_count;
    else typed.set(row.st, (typed.get(row.st) ?? 0) + row.genome_count);
  }
  const ranked = [...typed.entries()].sort((a, b) => b[1] - a[1] || compareSt(a[0], b[0]));
  const top = ranked.slice(0, TOP_STS);
  const rest = ranked.slice(TOP_STS);
  const bars: StBar[] = top.map(([st, count]) => ({
    values: [st],
    isOther: false,
    genomeCount: count,
  }));
  if (rest.length > 0) {
    bars.push({
      values: rest.map(([st]) => st).sort(compareSt),
      isOther: true,
      genomeCount: rest.reduce((total, [, count]) => total + count, 0),
    });
  }
  return { noScheme: typed.size === 0, bars, untyped };
}

/**
 * The filters after clicking an ST bar (requirements §6.1 "replacing the
 * values already chosen in the fields it names"): the species filter becomes
 * exactly the panel's species (so the set is the bar's genomes, never the
 * same ST number of another species' scheme), and the ST filter becomes
 * exactly the bar's STs (one, or the STs the "other" bar stands for); other
 * fields are kept.
 */
export function withStBar(filters: GenomeFilters, speciesCode: string, bar: StBar): GenomeFilters {
  return withKey(withKey(filters, 'species_code', [speciesCode]), 'st', [...bar.values]);
}
