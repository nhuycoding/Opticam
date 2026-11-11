import { useEffect, useState } from 'react';
import { Circle, Image as KImage, Layer, Rect, Shape } from 'react-konva';
import type { Layout } from '../../types';
import type { Pt } from '../../core/geometry';
import { PAD } from './shared';

function useImg(src?: string) {
  const [img, set] = useState<HTMLImageElement>();
  useEffect(() => { if (!src) { set(undefined); return; } const i = new Image(); i.onload = () => set(i); i.src = src; }, [src]);
  return img;
}

/** LAYER 1 — nền tĩnh (listening=false): ảnh nền theo mét, lưới 0.5 m, tường bao, điểm neo. */
export function BaseGridLayer({ layout: L, showGrid, showAnchors, anchors }: { layout: Layout; showGrid: boolean; showAnchors: boolean; anchors: Pt[] }) {
  const ppm = L.pixelsPerMeter, px = (m: number) => m * ppm, W = px(L.widthM), H = px(L.heightM);
  const bg = useImg(L.background?.dataUrl), g = px(L.gridM);
  return (
    <Layer x={PAD} y={PAD} listening={false}>
      <Rect width={W} height={H} fill="#101b20" />
      <Shape sceneFunc={(ctx) => {
        const tile = ppm;
        ctx.setAttr('fillStyle', 'rgba(174,199,192,.025)');
        for (let row = 0, y = 0; y < H; row++, y += tile) {
          for (let col = 0, x = 0; x < W; col++, x += tile) {
            if ((row + col) % 2 === 0) ctx.fillRect(x, y, tile, tile);
          }
        }
      }} />
      {bg && L.background?.visible && <KImage image={bg} width={px(L.background.widthM)} height={(px(L.background.widthM) * bg.height) / bg.width} opacity={L.background.opacity} />}
      {showGrid && <Shape sceneFunc={(ctx) => {
        ctx.beginPath();
        for (let i = 0; i <= Math.round(L.widthM / L.gridM); i++) { ctx.moveTo(i * g, 0); ctx.lineTo(i * g, H); }
        for (let j = 0; j <= Math.round(L.heightM / L.gridM); j++) { ctx.moveTo(0, j * g); ctx.lineTo(W, j * g); }
        ctx.setAttr('strokeStyle', 'rgba(177,196,190,.13)'); ctx.setAttr('lineWidth', 0.5); ctx.stroke();
      }} />}
      {showGrid && <Shape sceneFunc={(ctx) => {
        ctx.beginPath();
        for (let x = 1; x < L.widthM; x++) { ctx.moveTo(px(x), 0); ctx.lineTo(px(x), H); }
        for (let y = 1; y < L.heightM; y++) { ctx.moveTo(0, px(y)); ctx.lineTo(W, px(y)); }
        ctx.setAttr('strokeStyle', 'rgba(185,202,195,.2)'); ctx.setAttr('lineWidth', 0.9); ctx.stroke();
      }} />}
      <Rect width={W} height={H} stroke="#839993" strokeWidth={5} />
      <Rect x={3} y={3} width={W - 6} height={H - 6} stroke="rgba(225,239,231,.72)" strokeWidth={1} />
      {showAnchors && anchors.map(([x, y]) => <Circle key={`${x}_${y}`} x={px(x)} y={px(y)} radius={3} fill="#fff" stroke="#087e83" strokeWidth={1} />)}
    </Layer>
  );
}
