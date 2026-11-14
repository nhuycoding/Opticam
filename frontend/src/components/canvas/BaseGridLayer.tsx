import { floorOutline } from '../../core/footprint';
import { traceOutline } from './planDrawing';
import { useEffect, useState } from 'react';
import { Circle, Group, Image as KImage, Layer, Rect, Shape } from 'react-konva';
import type { Layout } from '../../types';
import type { Pt } from '../../core/geometry';
import { PAD } from './shared';

function useImg(src?: string) {
  const [img, set] = useState<HTMLImageElement>();
  useEffect(() => {
    set(undefined);
    if (!src) return;
    const image = new Image();
    image.onload = () => set(image);
    image.src = src;
    return () => { image.onload = null; image.onerror = null; };
  }, [src]);
  return img;
}

/** LAYER 1 — nền tĩnh (listening=false): ảnh nền theo mét, lưới 0.5 m, tường bao, điểm neo. */
export function BaseGridLayer({ layout: L, showGrid, showAnchors, anchors }: { layout: Layout; showGrid: boolean; showAnchors: boolean; anchors: Pt[] }) {
  const ppm = L.pixelsPerMeter, px = (m: number) => m * ppm, W = px(L.widthM), H = px(L.heightM);
  const outline = floorOutline(L);
  const bg = useImg(L.background?.dataUrl), g = px(L.gridM);
  return (
    <Layer x={PAD} y={PAD} listening={false}>
      <Shape sceneFunc={(ctx, shape) => { traceOutline(ctx, outline, ppm); ctx.fillStrokeShape(shape); }} fill="#f3f3e9" />
      <Group clipFunc={ctx => traceOutline(ctx, outline, ppm)}>
      <Shape sceneFunc={(ctx) => {
        const tile = ppm;
        ctx.setAttr('fillStyle', 'rgba(152,156,125,.025)');
        for (let row = 0, y = 0; y < H; row++, y += tile) {
          for (let col = 0, x = 0; x < W; col++, x += tile) {
            if ((row + col) % 2 === 0) ctx.fillRect(x, y, tile, tile);
          }
        }
      }} />
      {bg && L.background?.visible && <Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}><KImage image={bg} width={px(L.background.widthM)} height={(px(L.background.widthM) * bg.height) / bg.width} opacity={L.background.opacity} /></Group>}
      {showGrid && <Shape sceneFunc={(ctx) => {
        ctx.beginPath();
        for (let i = 0; i <= Math.floor(L.widthM / L.gridM); i++) { ctx.moveTo(i * g, 0); ctx.lineTo(i * g, H); }
        for (let j = 0; j <= Math.floor(L.heightM / L.gridM); j++) { ctx.moveTo(0, j * g); ctx.lineTo(W, j * g); }
        ctx.setAttr('strokeStyle', 'rgba(104,115,89,.13)'); ctx.setAttr('lineWidth', 0.5); ctx.stroke();
      }} />}
      {showGrid && <Shape sceneFunc={(ctx) => {
        ctx.beginPath();
        for (let x = 1; x < L.widthM; x++) { ctx.moveTo(px(x), 0); ctx.lineTo(px(x), H); }
        for (let y = 1; y < L.heightM; y++) { ctx.moveTo(0, px(y)); ctx.lineTo(W, px(y)); }
        ctx.setAttr('strokeStyle', 'rgba(104,115,89,.18)'); ctx.setAttr('lineWidth', 0.9); ctx.stroke();
      }} />}
      </Group>
      <Shape sceneFunc={(ctx, shape) => { traceOutline(ctx, outline, ppm); ctx.strokeShape(shape); }} stroke="#c3c6b7" strokeWidth={9} lineJoin="miter" />
      <Shape sceneFunc={(ctx, shape) => { traceOutline(ctx, outline, ppm); ctx.strokeShape(shape); }} stroke="#647156" strokeWidth={1.4} />
      <Shape sceneFunc={ctx => {
        ctx.beginPath();
        outline.forEach((a, i) => {
          const b = outline[(i + 1) % outline.length];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * ppm;
          const ux = (b[0] - a[0]) * ppm / length, uy = (b[1] - a[1]) * ppm / length;
          for (let t = 0; t < length; t += 8) {
            const x = a[0] * ppm + ux * t, y = a[1] * ppm + uy * t;
            ctx.moveTo(x - uy * 3 - ux * 2, y + ux * 3 - uy * 2);
            ctx.lineTo(x + uy * 3 + ux * 2, y - ux * 3 + uy * 2);
          }
        });
        ctx.setAttr('strokeStyle', '#8f9780'); ctx.setAttr('lineWidth', .5); ctx.stroke();
      }} />
      {showAnchors && anchors.map(([x, y]) => <Circle key={`${x}_${y}`} x={px(x)} y={px(y)} radius={3} fill="#fff" stroke="#765d42" strokeWidth={1} />)}
    </Layer>
  );
}
