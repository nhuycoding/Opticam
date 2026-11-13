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
  const bg = useImg(L.background?.dataUrl), g = px(L.gridM);
  return (
    <Layer x={PAD} y={PAD} listening={false}>
      <Rect width={W} height={H} fill="#f3f3e9" />
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
      <Rect x={-5} y={-5} width={W + 10} height={H + 10} stroke="#c3c6b7" strokeWidth={8} />
      <Rect width={W} height={H} stroke="#545f4d" strokeWidth={1.5} />
      <Rect x={-9} y={-9} width={W + 18} height={H + 18} stroke="#858e77" strokeWidth={1} />
      <Shape sceneFunc={(ctx) => {
        ctx.beginPath();
        for (let x = 0; x < W; x += 7) { ctx.moveTo(x - 3, -8); ctx.lineTo(x + 2, -2); ctx.moveTo(x - 3, H + 2); ctx.lineTo(x + 2, H + 8); }
        for (let y = 0; y < H; y += 7) { ctx.moveTo(-8, y - 3); ctx.lineTo(-2, y + 2); ctx.moveTo(W + 2, y - 3); ctx.lineTo(W + 8, y + 2); }
        ctx.setAttr('strokeStyle', '#8f9780'); ctx.setAttr('lineWidth', 0.6); ctx.stroke();
      }} />
      {showAnchors && anchors.map(([x, y]) => <Circle key={`${x}_${y}`} x={px(x)} y={px(y)} radius={3} fill="#fff" stroke="#765d42" strokeWidth={1} />)}
    </Layer>
  );
}
