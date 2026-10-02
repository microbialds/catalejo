// Resistance class by species heatmap (requirements §5.4, §6.1; contract
// §6.2 amr_class_by_species). Rows are the chart groups of the set's species
// (the "Other" rule of ./species.ts), columns the drug classes present in the
// set in palette order. A cell is the fraction of the row's genomes with at
// least one hit in the class, drawn as a solid fill from the seven steps of
// palette.sequential.heatmap (light to dark), never at reduced opacity.
// A fraction above zero falls in one of seven equal bins, so that 1/7 and
// above leave the first step and 6/7 and above reach the last. A cell at zero
// takes no step and stays on the panel white, so that "no genome" never
// reads as the lightest nonzero step. Values are shown as integer percent;
// cell text is chrome.on_ink on the last three steps and chrome.ink on the
// first four and on zero (the contrast stated in config/palette.yaml).
// The legend (§6.1, §8 "legend included") lists the zero swatch and the seven
// steps with the integer percents each step holds, read from heatStep itself
// so that the labels never drift from the cells.
import type { AmrClassRow } from '../data/setEngine';
import { palette } from '../generated/palette';
import { compareText } from '../set/filters';
import { drugClassOrder } from '../set/fields';
import { strings } from '../strings';
import type { ChartGroup } from './species';
import { groupOfSpecies } from './species';

/** The steps of the scale, light to dark. */
export const HEAT_SCALE: readonly string[] = palette.sequential.heatmap;

export const HEAT_STEPS = HEAT_SCALE.length;

/** Steps from this one up carry chrome.on_ink text (the last three). */
const FIRST_ON_INK_STEP = HEAT_STEPS - 2;

/** The step of a fraction: 0 for none, else 1 to HEAT_STEPS. */
export function heatStep(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(HEAT_STEPS, Math.floor(fraction * HEAT_STEPS) + 1);
}

/** The solid fill of a step; undefined for zero, which stays on the panel. */
export function heatFill(step: number): string | undefined {
  return step > 0 ? HEAT_SCALE[step - 1] : undefined;
}

/** Whether the cell text of a step is chrome.on_ink rather than chrome.ink. */
export function heatTextOnInk(step: number): boolean {
  return step >= FIRST_ON_INK_STEP;
}

/** The integer percent shown in a cell. */
export function heatPercent(fraction: number): number {
  return Math.round(fraction * 100);
}

export interface HeatLegendEntry {
  /** 0 for the zero swatch, else 1 to HEAT_STEPS. */
  step: number;
  /** The solid fill; undefined for zero, drawn on the panel with a border. */
  fill: string | undefined;
  /** The smallest and largest integer percent the step holds. */
  min: number;
  max: number;
}

/**
 * The legend of the scale: zero, then each step with the integer percents p
 * (1 to 100) for which heatStep(p / 100) is that step.
 */
export function heatLegend(): HeatLegendEntry[] {
  const entries: HeatLegendEntry[] = [{ step: 0, fill: undefined, min: 0, max: 0 }];
  for (let percent = 1; percent <= 100; percent += 1) {
    const step = heatStep(percent / 100);
    const known = entries.find((entry) => entry.step === step);
    if (known === undefined)
      entries.push({ step, fill: heatFill(step), min: percent, max: percent });
    else known.max = percent;
  }
  return entries.sort((a, b) => a.step - b.step);
}

/** The label of a legend entry: "0%" for zero, else its range of integer percents. */
export function heatLegendLabel(entry: HeatLegendEntry): string {
  return entry.step === 0
    ? strings.heatmapLegendZero
    : strings.heatmapLegendRange(String(entry.min), String(entry.max));
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
