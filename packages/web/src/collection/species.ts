// Species groups of the collection charts (requirements §5.4, §6.1; checklist
// C7). The species of a set are ranked by genome count, descending, ties by
// species code ascending. When more than `chart_species_max` species are
// present (config/platform.yaml), the first that many are drawn
// individually and the rest are grouped as "Other" in the species bars, the
// year chart and the heatmap rows; with that many or fewer there is no
// "Other". Tables, chips and facets always show individual species.
//
// Colors: an individual species keeps its registry color (the summaries'
// `color`), "Other" is the palette's species.other. A mark in a species color
// listed in the design tokens' marks.species_outlines (the yellow) carries a
// thin ink outline on light backgrounds.
import { palette } from '../generated/palette';
import { platformConfig } from '../generated/platform';
import { tokens } from '../generated/tokens';
import { compareText, withKey } from '../set/filters';
import type { GenomeFilters } from '../set/filters';
import { strings } from '../strings';

export interface SpeciesCount {
  species_code: string;
  canonical_name: string;
  color: string;
  genome_count: number;
}

/** One drawn series: a species, or "Other" holding several. */
export interface ChartGroup {
  /** The species code, or OTHER_KEY. */
  key: string;
  /** Full label: the canonical name, or "Other". */
  label: string;
  /** Whether the label is a species name (italic sans). */
  isSpecies: boolean;
  color: string;
  /** The species codes the group stands for. */
  codes: string[];
  genomeCount: number;
}

export const OTHER_KEY = '\u0000other';

/** Species with genomes, ranked by genome count descending, ties by code. */
export function rankSpecies<T extends { species_code: string; genome_count: number }>(
  rows: readonly T[],
): T[] {
  return rows
    .filter((row) => row.genome_count > 0)
    .sort((a, b) => b.genome_count - a.genome_count || compareText(a.species_code, b.species_code));
}

/** The chart groups of a set's species (requirements §6.1, "Other" rule). */
export function speciesGroups(
  rows: readonly SpeciesCount[],
  max: number = platformConfig.chartSpeciesMax,
): ChartGroup[] {
  const ranked = rankSpecies(rows);
  const single = (row: SpeciesCount): ChartGroup => ({
    key: row.species_code,
    label: row.canonical_name,
    isSpecies: true,
    color: row.color,
    codes: [row.species_code],
    genomeCount: row.genome_count,
  });
  if (ranked.length <= max) return ranked.map(single);
  const kept = ranked.slice(0, max).map(single);
  const rest = ranked.slice(max);
  return [
    ...kept,
    {
      key: OTHER_KEY,
      label: strings.chartOther,
      isSpecies: false,
      color: palette.species.other,
      codes: rest.map((row) => row.species_code),
      genomeCount: rest.reduce((total, row) => total + row.genome_count, 0),
    },
  ];
}

/** The group key of every species code in the groups. */
export function groupOfSpecies(groups: readonly ChartGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) for (const code of group.codes) map.set(code, group.key);
  return map;
}

export interface MarkOutline {
  width: string;
  color: string;
}

/** The outline a mark in this color needs on a light background, if any. */
export function speciesOutline(color: string): MarkOutline | undefined {
  const folded = color.toLowerCase();
  const rules: readonly {
    background: string;
    speciesColor: string;
    outlineWidth: string;
    outlineColor: string;
  }[] = tokens.marks.speciesOutlines;
  const rule = rules.find(
    (outline) => outline.background === 'light' && outline.speciesColor.toLowerCase() === folded,
  );
  return rule === undefined ? undefined : { width: rule.outlineWidth, color: rule.outlineColor };
}

/** Inline style for an HTML mark filled with a data color (bar, swatch, segment). */
export function markStyle(color: string): {
  backgroundColor: string;
  outline?: string;
  outlineOffset?: string;
} {
  const outline = speciesOutline(color);
  if (outline === undefined) return { backgroundColor: color };
  return {
    backgroundColor: color,
    outline: `${outline.width} solid ${outline.color}`,
    outlineOffset: `-${outline.width}`,
  };
}

/**
 * The filters after clicking a species mark (a bar, a heatmap row): the
 * species filter becomes the group's species, so the set narrows to what the
 * mark shows even when several species were selected before.
 */
export function withSpecies(filters: GenomeFilters, codes: readonly string[]): GenomeFilters {
  return withKey(filters, 'species_code', [...codes]);
}
