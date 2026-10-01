// Assembly QC scatter (requirements §6.1; checklist C3; collection board,
// second panel row; maintainer decision for the marks). X is CheckM2
// completeness, Y contamination; the thresholds of config/platform.yaml are
// dashed ink lines. Axes and thresholds are 1 px ink hairlines on half-pixel
// coordinates with crisp edges, so they paint the ink itself and not an
// antialiased gray (requirements §7; checklist G3). Passing genomes are solid
// dots in chrome text_secondary, failing ones hollow with an ink stroke, both
// drawn as is with no opacity (requirements §5.4; checklist G3), and the
// subtitle states how many are flagged and how many lack CheckM2 values (not
// drawn). Dragging on the plot draws a hollow rectangle with an ink stroke;
// on release its left completeness and top contamination become the
// completeness_min and contamination_max filters (collection/qc.ts). The
// keyboard alternative is the add filter menu, which the description of the
// plot names.
import { useId, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  brushBounds,
  crisp,
  isFailing,
  qcDomain,
  qcScale,
  qcSummary,
  withBrush,
} from '../../collection/qc';
import type { BrushRect } from '../../collection/qc';
import { Panel } from '../../components/Panel';
import type { PanelExpansion } from '../../components/Panel';
import type { QcPoint } from '../../data/setEngine';
import { formatCount } from '../../format';
import { palette } from '../../generated/palette';
import { platformConfig } from '../../generated/platform';
import { tokens } from '../../generated/tokens';
import { useGenomeSet } from '../../set/store';
import { strings } from '../../strings';
import { PanelStatus } from './PanelStatus';
import { useElementWidth } from './useElementWidth';

const MARGIN = { left: 30, right: 10, top: 4, bottom: 16 };
const MIN_BRUSH = 3;
const HAIRLINE = 1;
const THRESHOLD_DASH = '4 3';
const ink = palette.chrome.ink;
const secondary = palette.chrome.text_secondary;
const mono = tokens.typography.families.mono;

function tick(value: number): string {
  return String(Number(value.toFixed(1)));
}

export function QcPanel({
  points,
  failed,
  expansion,
}: {
  points: QcPoint[] | undefined;
  failed: boolean;
  expansion: PanelExpansion;
}) {
  const { updateFilters } = useGenomeSet();
  const [measure, width] = useElementWidth(330);
  const [brush, setBrush] = useState<BrushRect | null>(null);
  const descriptionId = useId();
  const height = expansion.expanded ? 280 : 100;
  const summary = points === undefined ? undefined : qcSummary(points);
  const parts: string[] = [];
  if (summary !== undefined) {
    parts.push(strings.qcFlagged(formatCount(summary.flagged)));
    if (summary.missing > 0) parts.push(strings.qcMissing(formatCount(summary.missing)));
  }
  const domain = qcDomain(summary?.drawn ?? []);
  const box = {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(1, width - MARGIN.left - MARGIN.right),
    height: Math.max(1, height - MARGIN.top - MARGIN.bottom),
  };
  const scale = qcScale(domain, box);
  const { completenessMin, contaminationMax } = platformConfig.qc;

  const local = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(box.left + box.width, Math.max(box.left, event.clientX - rect.left));
    const y = Math.min(box.top + box.height, Math.max(box.top, event.clientY - rect.top));
    return { x, y };
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = local(event);
    setBrush({ x0: x, y0: y, x1: x, y1: y });
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (brush === null) return;
    const { x, y } = local(event);
    setBrush({ ...brush, x1: x, y1: y });
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (brush === null) return;
    const { x, y } = local(event);
    const rect = { ...brush, x1: x, y1: y };
    setBrush(null);
    if (Math.abs(rect.x1 - rect.x0) < MIN_BRUSH && Math.abs(rect.y1 - rect.y0) < MIN_BRUSH) return;
    updateFilters((current) => withBrush(current, brushBounds(rect, scale)));
  };

  const bottom = box.top + box.height;
  const right = box.left + box.width;
  // Axes and thresholds are 1 px ink hairlines on half-pixel coordinates.
  const left = box.left;
  const axisX = crisp(box.left);
  const axisY = crisp(bottom);
  const thresholdX = crisp(scale.x(completenessMin));
  const thresholdY = crisp(scale.y(contaminationMax));
  const xTicks = [domain.completeness[0], completenessMin, domain.completeness[1]];
  const yTicks = [contaminationMax, domain.contamination[1]];

  return (
    <Panel
      title={strings.panelQc}
      name={strings.panelQc}
      {...(parts.length > 0 ? { subtitle: parts.join(strings.separator) } : {})}
      expansion={expansion}
    >
      <div ref={measure} className="min-w-0">
        {summary === undefined ? (
          <PanelStatus failed={failed} />
        ) : summary.drawn.length === 0 ? (
          <p className="text-control text-text-secondary">{strings.qcNoPoints}</p>
        ) : (
          <>
            <p id={descriptionId} className="sr-only">
              {strings.qcBrushDescription}
            </p>
            <svg
              role="img"
              aria-label={strings.qcChartName}
              aria-describedby={descriptionId}
              width={width}
              height={height}
              viewBox={`0 0 ${String(width)} ${String(height)}`}
              className="block cursor-crosshair touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                setBrush(null);
              }}
            >
              <g stroke={ink} strokeWidth={HAIRLINE} shapeRendering="crispEdges">
                <line x1={left} y1={axisY} x2={right} y2={axisY} />
                <line x1={axisX} y1={box.top} x2={axisX} y2={bottom} />
                <line
                  x1={left}
                  x2={right}
                  y1={thresholdY}
                  y2={thresholdY}
                  strokeDasharray={THRESHOLD_DASH}
                />
                <line
                  x1={thresholdX}
                  x2={thresholdX}
                  y1={box.top}
                  y2={bottom}
                  strokeDasharray={THRESHOLD_DASH}
                />
              </g>
              <g>
                {summary.drawn.map((point) => {
                  const cx = scale.x(point.completeness ?? 0);
                  const cy = scale.y(point.contamination ?? 0);
                  return isFailing(point) ? (
                    <circle
                      key={point.genome_id}
                      cx={cx}
                      cy={cy}
                      r={2.4}
                      fill="none"
                      stroke={ink}
                      strokeWidth={0.9}
                    />
                  ) : (
                    <circle key={point.genome_id} cx={cx} cy={cy} r={2} fill={secondary} />
                  );
                })}
              </g>
              <g fontFamily={mono} fontSize={10} fill={secondary}>
                {xTicks.map((value, index) => (
                  <text
                    key={`x${String(index)}`}
                    x={scale.x(value)}
                    y={height - 3}
                    textAnchor={
                      index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'
                    }
                  >
                    {strings.qcTickValue(tick(value))}
                  </text>
                ))}
                {yTicks.map((value, index) => (
                  <text
                    key={`y${String(index)}`}
                    x={box.left - 4}
                    y={scale.y(value) + 3}
                    textAnchor="end"
                  >
                    {strings.qcTickPercent(tick(value))}
                  </text>
                ))}
              </g>
              {brush !== null && (
                <rect
                  x={Math.min(brush.x0, brush.x1)}
                  y={Math.min(brush.y0, brush.y1)}
                  width={Math.abs(brush.x1 - brush.x0)}
                  height={Math.abs(brush.y1 - brush.y0)}
                  fill="none"
                  stroke={ink}
                  strokeWidth={HAIRLINE}
                  shapeRendering="crispEdges"
                />
              )}
            </svg>
          </>
        )}
      </div>
    </Panel>
  );
}
