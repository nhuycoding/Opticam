import { memo } from 'react';
import { Layer, Shape } from 'react-konva';
import type { Cell, Layout } from '../../types';
import { PlanAnnotationsLayer } from './PlanAnnotationsLayer';
import { DORI_COLOR, PAD, priorityBand, riskColor, shouldShowRiskWeight, type PriorityBand, type ViewMode } from './shared';

/** LAYER 2 — Heatmap DORI / Ma trận rủi ro. Một Shape duy nhất; đo thời gian vẽ vào drawMsRef (KPI ≤ 200 ms). */
export const HeatmapLayer = memo(function HeatmapLayer({ layout, cells, cellPx, view, drawMsRef, riskFilter, hoveredCell, focusCell, showBoundaries, zoom, numberMasks }: {
  layout: Layout;
  cells: Cell[]; cellPx: number; view: ViewMode; drawMsRef: { current: number };
  riskFilter: PriorityBand | null; hoveredCell: { r: number; c: number } | null;
  focusCell: { r: number; c: number } | null; showBoundaries: boolean; zoom: number;
  numberMasks: { x: number; y: number; width: number; height: number }[];
}) {
  const cellsByPosition = new Map(cells.map((cell) => [`${cell.r}_${cell.c}`, cell]));
  return (
    <Layer x={PAD} y={PAD} listening={false}>
      <Shape visible={view !== 'off'} sceneFunc={(ctx) => {
        const t0 = performance.now();
        for (const c of cells) {
          if (c.solid) continue;
          const band = priorityBand(c.w);
          ctx.setAttr('globalAlpha', view === 'risk' && riskFilter && band !== riskFilter ? 0.12 : 1);
          ctx.setAttr('fillStyle', view === 'dori' ? DORI_COLOR[c.dori] : riskColor(c.w));
          ctx.fillRect(c.c * cellPx, c.r * cellPx, cellPx, cellPx);
          const labelBox = { x: c.c * cellPx, y: c.r * cellPx, width: cellPx, height: cellPx };
          const labelBlocked = numberMasks.some((mask) =>
            labelBox.x < mask.x + mask.width && labelBox.x + labelBox.width > mask.x &&
            labelBox.y < mask.y + mask.height && labelBox.y + labelBox.height > mask.y
          );
          if (view === 'risk' && !labelBlocked && shouldShowRiskWeight(c.w, layout.gridM)) {
            ctx.setAttr('font', `700 ${Math.min(12 / zoom, cellPx * 0.32)}px "Segoe UI", sans-serif`);
            ctx.setAttr('textAlign', 'center');
            ctx.setAttr('textBaseline', 'middle');
            ctx.setAttr('lineWidth', 2.5);
            ctx.setAttr('strokeStyle', 'rgba(10,19,24,.82)');
            ctx.strokeText(c.w.toFixed(1), (c.c + 0.5) * cellPx, (c.r + 0.5) * cellPx);
            ctx.setAttr('fillStyle', '#fff');
            ctx.fillText(c.w.toFixed(1), (c.c + 0.5) * cellPx, (c.r + 0.5) * cellPx);
          }
          ctx.setAttr('globalAlpha', 1);
        }
        if (view === 'risk' && showBoundaries) {
          ctx.beginPath();
          for (const c of cells) {
            if (c.solid) continue;
            const right = cellsByPosition.get(`${c.r}_${c.c + 1}`);
            const below = cellsByPosition.get(`${c.r + 1}_${c.c}`);
            if (right && !right.solid && priorityBand(c.w) !== priorityBand(right.w)) {
              ctx.moveTo((c.c + 1) * cellPx, c.r * cellPx);
              ctx.lineTo((c.c + 1) * cellPx, (c.r + 1) * cellPx);
            }
            if (below && !below.solid && priorityBand(c.w) !== priorityBand(below.w)) {
              ctx.moveTo(c.c * cellPx, (c.r + 1) * cellPx);
              ctx.lineTo((c.c + 1) * cellPx, (c.r + 1) * cellPx);
            }
          }
          ctx.setAttr('strokeStyle', 'rgba(231,238,233,.5)');
          ctx.setAttr('lineWidth', 1);
          ctx.stroke();
        }
        const highlight = hoveredCell ?? focusCell;
        if (highlight && view === 'risk') {
          ctx.setAttr('strokeStyle', 'rgba(9,18,23,.9)');
          ctx.setAttr('lineWidth', 4);
          ctx.strokeRect(highlight.c * cellPx, highlight.r * cellPx, cellPx, cellPx);
          ctx.setAttr('strokeStyle', '#fff');
          ctx.setAttr('lineWidth', 1.5);
          ctx.strokeRect(highlight.c * cellPx + 1, highlight.r * cellPx + 1, cellPx - 2, cellPx - 2);
        }
        drawMsRef.current = performance.now() - t0;
      }} />
      <PlanAnnotationsLayer layout={layout} />
    </Layer>
  );
});
