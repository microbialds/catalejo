// Genomes by year, stacked by species (requirements §6.1; contract §6.2
// counts_by_species_year). One column per year from the first to the last
// isolation year of the set, gaps included, each stacked by the chart groups
// of ./species.ts in rank order from the bottom. Genomes without an
// isolation date are not drawn; the panel states how many.
import type { SpeciesYearRow } from '../data/setEngine';
import type { ChartGroup } from './species';
import { groupOfSpecies } from './species';

export interface YearSegment {
  group: ChartGroup;
  genomeCount: number;
}

export interface YearColumn {
  year: number;
  total: number;
  /** Segments in group order, bottom first; groups without genomes left out. */
  segments: YearSegment[];
}

export interface YearChart {
  columns: YearColumn[];
  undated: number;
  maxTotal: number;
}

export function buildYearChart(
  groups: readonly ChartGroup[],
  rows: readonly SpeciesYearRow[],
): YearChart {
  const groupOf = groupOfSpecies(groups);
  const byYear = new Map<number, Map<string, number>>();
  let undated = 0;
  for (const row of rows) {
    if (row.genome_count <= 0) continue;
    if (row.year === null) {
      undated += row.genome_count;
      continue;
    }
    const key = groupOf.get(row.species_code);
    if (key === undefined) continue;
    let byGroup = byYear.get(row.year);
    if (byGroup === undefined) {
      byGroup = new Map();
      byYear.set(row.year, byGroup);
    }
    byGroup.set(key, (byGroup.get(key) ?? 0) + row.genome_count);
  }
  const years = [...byYear.keys()];
  if (years.length === 0) return { columns: [], undated, maxTotal: 0 };
  const first = Math.min(...years);
  const last = Math.max(...years);
  const columns: YearColumn[] = [];
  for (let year = first; year <= last; year += 1) {
    const byGroup = byYear.get(year);
    const segments = groups
      .map((group) => ({ group, genomeCount: byGroup?.get(group.key) ?? 0 }))
      .filter((segment) => segment.genomeCount > 0);
    columns.push({
      year,
      total: segments.reduce((total, segment) => total + segment.genomeCount, 0),
      segments,
    });
  }
  return { columns, undated, maxTotal: Math.max(...columns.map((column) => column.total)) };
}

/** Every how many years an axis label is written, for a given column count. */
export function yearLabelStep(columns: number, maxLabels: number): number {
  if (columns <= maxLabels || maxLabels <= 0) return 1;
  return Math.ceil(columns / maxLabels);
}
