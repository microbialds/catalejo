// Assembly QC scatter (requirements §6.1; contract §6.2 summaries/qc.parquet;
// checklist C3). X is CheckM2 completeness and Y contamination, both percent;
// the thresholds of config/platform.yaml are drawn as dashed ink lines. A
// genome without CheckM2 values is not drawn and is counted in the subtitle.
//
// Brushing: the rectangle drawn on the plot becomes two filters, the
// completeness at its left edge as `completeness_min` and the contamination
// at its top edge as `contamination_max`, rounded to 0.1, replacing earlier
// values of those two keys (data contract §7.5).
import type { QcPoint } from '../data/setEngine';
import { platformConfig } from '../generated/platform';
import type { GenomeFilters } from '../set/filters';
import { withKey } from '../set/filters';

export interface QcDomain {
  completeness: [number, number];
  contamination: [number, number];
}

const STEP = 5;

/**
 * The axes: completeness from at most 15 points below the threshold (80 for
 * the default 95) to 100, extended down to the lowest point; contamination
 * from 0 to at least twice its threshold, extended up to the highest point.
 */
export function qcDomain(points: readonly QcPoint[], qc = platformConfig.qc): QcDomain {
  let low = qc.completenessMin - 15;
  let high = qc.contaminationMax * 2;
  for (const point of points) {
    if (point.completeness !== null && point.contamination !== null) {
      low = Math.min(low, Math.floor(point.completeness / STEP) * STEP);
      high = Math.max(high, Math.ceil(point.contamination / STEP) * STEP);
    }
  }
  return { completeness: [Math.max(0, low), 100], contamination: [0, high] };
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface QcScale {
  x: (completeness: number) => number;
  y: (contamination: number) => number;
  completenessAt: (px: number) => number;
  contaminationAt: (py: number) => number;
}

export function qcScale(domain: QcDomain, box: PlotBox): QcScale {
  const [c0, c1] = domain.completeness;
  const [m0, m1] = domain.contamination;
  const cSpan = c1 - c0 || 1;
  const mSpan = m1 - m0 || 1;
  return {
    x: (value) => box.left + ((value - c0) / cSpan) * box.width,
    y: (value) => box.top + box.height - ((value - m0) / mSpan) * box.height,
    completenessAt: (px) => c0 + ((px - box.left) / box.width) * cSpan,
    contaminationAt: (py) => m0 + ((box.top + box.height - py) / box.height) * mSpan,
  };
}

/**
 * A coordinate for a 1 px hairline: the middle of the pixel the value falls
 * in, so the stroke covers exactly one row or column of pixels and paints the
 * full ink color instead of two antialiased rows of gray (requirements §7,
 * hairline borders; checklist G3).
 */
export function crisp(value: number): number {
  return Math.floor(value) + 0.5;
}

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface BrushRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The completeness and contamination bounds of a brushed rectangle. */
export function brushBounds(
  rect: BrushRect,
  scale: QcScale,
): { completenessMin: number; contaminationMax: number } {
  const left = Math.min(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const completeness = Math.min(100, Math.max(0, scale.completenessAt(left)));
  const contamination = Math.min(100, Math.max(0, scale.contaminationAt(top)));
  return { completenessMin: roundTenth(completeness), contaminationMax: roundTenth(contamination) };
}

/** The filters after a brush: both keys replaced in one change. */
export function withBrush(
  filters: GenomeFilters,
  bounds: { completenessMin: number; contaminationMax: number },
): GenomeFilters {
  return withKey(
    withKey(filters, 'completeness_min', bounds.completenessMin),
    'contamination_max',
    bounds.contaminationMax,
  );
}

export interface QcSummary {
  drawn: QcPoint[];
  flagged: number;
  missing: number;
}

/** Points with both values, the failing count and the missing count. */
export function qcSummary(points: readonly QcPoint[]): QcSummary {
  const drawn: QcPoint[] = [];
  let flagged = 0;
  let missing = 0;
  for (const point of points) {
    if (point.completeness === null || point.contamination === null) {
      missing += 1;
      continue;
    }
    drawn.push(point);
    if (isFailing(point)) flagged += 1;
  }
  return { drawn, flagged, missing };
}

/** A point fails when its flag says so, or by the thresholds when unflagged. */
export function isFailing(point: QcPoint, qc = platformConfig.qc): boolean {
  if (point.flag === 'fail') return true;
  if (point.flag === 'pass') return false;
  return (
    point.completeness !== null &&
    point.contamination !== null &&
    (point.completeness < qc.completenessMin || point.contamination > qc.contaminationMax)
  );
}
