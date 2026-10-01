// Resistance class by species heatmap (requirements §6.1; contract §6.2
// amr_class_by_species). Rows are the chart groups of the set's species (the
// "Other" rule of ./species.ts), columns the drug classes present in the set
// in palette order. A cell is the fraction of the row's genomes with at
// least one hit in the class, drawn in chrome ink at a stepped opacity
// (maintainer decision): zero is no fill, and any other fraction falls in one
// of HEAT_STEPS equal bins, so that 50% and above sit in the upper half.
// Values are shown as integer percent; text is white from 50% upward and ink
// below.
import type { AmrClassRow } from '../data/setEngine';
import { compareText } from '../set/filters';
import { drugClassOrder } from '../set/fields';
import type { ChartGroup } from './species';
import { groupOfSpecies } from './species';

export const HEAT_STEPS = 6;

/** The opacity step of a fraction: 0 for none, else 1 to HEAT_STEPS. */
export function heatStep(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(HEAT_STEPS, Math.floor(fraction * HEAT_STEPS) + 1);
}

/** The ink opacity of a step. */
export function heatOpacity(step: number): number {
  return step / HEAT_STEPS;
}

/** Whether the cell text is white (on ink) rather than ink. */
export function heatTextOnInk(fraction: number): boolean {
  return fraction >= 0.5;
}

/** The integer percent shown in a cell. */
export function heatPercent(fraction: number): number {
  return Math.round(fraction * 100);
}

export interface HeatCell {
  drugClass: string;
  genomeCount: number;
  fraction: number;
}

export interface HeatRow {
  group: ChartGroup;
  cells: HeatCell[];
}

export interface Heatmap {
  /** Drug class keys present in the set, in palette order. */
  classes: string[];
  rows: HeatRow[];
}

/** The heatmap of a set from its species-grain AMR class counts. */
export function buildHeatmap(groups: readonly ChartGroup[], rows: readonly AmrClassRow[]): Heatmap {
  const groupOf = groupOfSpecies(groups);
  const present = new Set<string>();
  // genomes with a hit, per group and class
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.genome_count <= 0) continue;
    const key = groupOf.get(row.species_code);
    if (key === undefined) continue;
    present.add(row.drug_class);
    let byClass = counts.get(key);
    if (byClass === undefined) {
      byClass = new Map();
      counts.set(key, byClass);
    }
    byClass.set(row.drug_class, (byClass.get(row.drug_class) ?? 0) + row.genome_count);
  }
  const classes = [...present].sort(
    (a, b) => drugClassOrder(a) - drugClassOrder(b) || compareText(a, b),
  );
  return {
    classes,
    rows: groups.map((group) => ({
      group,
      cells: classes.map((drugClass) => {
        const genomeCount = counts.get(group.key)?.get(drugClass) ?? 0;
        return {
          drugClass,
          genomeCount,
          fraction: group.genomeCount > 0 ? genomeCount / group.genomeCount : 0,
        };
      }),
    })),
  };
}
