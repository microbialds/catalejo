// Assembly QC scatter (requirements §6.1; checklist C3; collection board,
// second panel row; maintainer decision for the marks). X is CheckM2
// completeness, Y contamination; the thresholds of config/platform.yaml are
// dashed ink lines (never the accent). Passing genomes are filled in
// secondary text gray, failing ones hollow with an ink stroke, and the
// subtitle states how many are flagged and how many lack CheckM2 values
// (not drawn). Dragging on the plot draws a rectangle; on release its left
// completeness and top contamination become the completeness_min and
// contamination_max filters (collection/qc.ts). The keyboard alternative is
// the add filter menu, which the description of the plot names.
import { useId, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  brushBounds,
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
  const { filters, setFilters } = useGenomeSet();
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
    setFilters(withBrush(filters, brushBounds(rect, scale)));
  };

  const bottom = box.top + box.height;
  const right = box.left + box.width;
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
              <line
                x1={box.left}
                y1={bottom}
                x2={right}
                y2={bottom}
                stroke={ink}
                strokeWidth={0.8}
              />
              <line
                x1={box.left}
                y1={box.top}
                x2={box.left}
                y2={bottom}
                stroke={ink}
                strokeWidth={0.8}
              />
              <line
                x1={box.left}
                x2={right}
                y1={scale.y(contaminationMax)}
                y2={scale.y(contaminationMax)}
                stroke={ink}
                strokeWidth={0.8}
                strokeDasharray="4 3"
              />
              <line
                x1={scale.x(completenessMin)}
                x2={scale.x(completenessMin)}
                y1={box.top}
                y2={bottom}
                stroke={ink}
                strokeWidth={0.8}
                strokeDasharray="4 3"
              />
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
                    <circle
                      key={point.genome_id}
                      cx={cx}
                      cy={cy}
                      r={2}
                      fill={secondary}
                      fillOpacity={0.6}
                    />
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
                  fill={ink}
                  fillOpacity={0.06}
                  stroke={ink}
                  strokeWidth={0.8}
                />
              )}
            </svg>
          </>
        )}
      </div>
    </Panel>
  );
}
