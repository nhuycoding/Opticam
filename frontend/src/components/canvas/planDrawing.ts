import type Konva from 'konva';
import type { Pt } from '../../core/geometry';

export function traceOutline(ctx: Konva.Context, polygon: Pt[], scale = 1): void {
  ctx.beginPath();
  polygon.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x * scale, y * scale);
    else ctx.lineTo(x * scale, y * scale);
  });
  ctx.closePath();
}
