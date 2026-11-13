import { footprintFits, floorOutline, placeWallFixture } from './footprint';
import type { Camera, Fixture, Layout, Obstacle, ObsType } from '../types';
import { clamp, obstacleFitsRoom, obsPoly, placeObstacle, round2, satCollide, snap, snapToWall } from './geometry';

export const TEMPLATES: Record<ObsType, Omit<Obstacle, 'id' | 'x' | 'y'>> = {
  shelf: { type: 'shelf', label: 'Kệ hàng', w: 4, h: 0.5, elev: 1.8, angle: 0, riskCategory: 'standard' },
  pos: { type: 'pos', label: 'Quầy POS', w: 2, h: 1, elev: 1.1, angle: 0 },
  entrance: { type: 'entrance', label: 'Cửa chính', w: 1.5, h: 0.2, elev: 2.2, angle: 0 }
};
export const AREA_MIN = 50, AREA_MAX = 80;

const hits = (l: Layout, o: Obstacle, margin = 0, ignore?: string) => {
  const inflated = { ...o, x: o.x - margin, y: o.y - margin, w: o.w + 2 * margin, h: o.h + 2 * margin };
  return l.obstacles.some((q) => q.id !== ignore && satCollide(obsPoly(inflated), obsPoly(q)));
};

/** Thêm khối chuẩn vào chỗ trống đầu tiên (kệ chừa lối đi ≥ 0.5 m nếu còn chỗ). Trả null nếu hết chỗ. */
export function addObstacle(l: Layout, type: ObsType, fixture?: Fixture): Layout | null {
  let i = l.obstacles.length + 1;
  while (l.obstacles.some((o) => o.id === `${type}_${i}`)) i++;
  const base: Obstacle = { ...TEMPLATES[type], id: `${type}_${i}`, x: 0, y: 0 };
  const { widthM: W, heightM: H, gridM: g } = l;
  if (fixture === 'wall-shelf') {
    const shelf = { ...base, fixture, label: 'Kệ sát tường', w: 2.4, h: .45 };
    const polygon = floorOutline(l);
    for (const [x, y] of polygon) {
      for (let cy = 0; cy <= H; cy += .5) {
        const placed = placeWallFixture(shelf, [x, cy], polygon);
        if (placed && !hits(l, placed)) return { ...l, obstacles: [...l.obstacles, placed], walkways: undefined };
      }
      for (let cx = 0; cx <= W; cx += .5) {
        const placed = placeWallFixture(shelf, [cx, y], polygon);
        if (placed && !hits(l, placed)) return { ...l, obstacles: [...l.obstacles, placed], walkways: undefined };
      }
    }
    return null;
  }
  const pts: [number, number][] = [];
  for (let cy = g; cy < H; cy += g) for (let cx = g; cx < W; cx += g) pts.push([cx, cy]);
  if (type === 'entrance') { pts.length = 0; for (let t = g; t < W; t += g) pts.push([t, 0], [t, H]); for (let t = g; t < H; t += g) pts.push([0, t], [W, t]); }
  const wall = (p: [number, number]) => Math.min(p[0], W - p[0], p[1], H - p[1]);
  const key = (p: [number, number]) => type === 'pos' ? wall(p) : Math.hypot(p[0] - W / 2, p[1] - H / 2) + (type === 'shelf' && wall(p) < 1 ? 1000 : 0);
  pts.sort((a, b) => key(a) - key(b));
  for (const margin of type === 'shelf' ? [0.5, 0] : [0]) for (const [cx, cy] of pts) {
    const n = type === 'entrance' && l.floorPolygon ? placeWallFixture(base, [cx,cy], l.floorPolygon) ?? base : placeObstacle(base, cx, cy, W, H, g);
    if (obstacleFitsRoom(n, W, H) && footprintFits(n, l.floorPolygon) && !hits(l, n, margin)) return { ...l, obstacles: [...l.obstacles, n], walkways: undefined };
  }
  return null;
}

export const removeObstacle = (l: Layout, id: string): Layout => ({ ...l, walkways: undefined, obstacles: l.obstacles.filter((o) => o.id !== id) });

/** Đổi kích thước quanh tâm; từ chối (trả layout cũ) nếu gây chồng lấn. */
export function resizeObstacle(l: Layout, id: string, w: number, h: number): Layout {
  const o = l.obstacles.find((x) => x.id === id); if (!o) return l;
  const resized = { ...o, w: clamp(w, 0.2, l.widthM), h: clamp(h, 0.2, l.heightM) };
  const center: [number,number] = [o.x+o.w/2,o.y+o.h/2];
  const n = o.fixture === 'wall-shelf' || (o.type === 'entrance' && l.floorPolygon)
    ? placeWallFixture(resized, center, floorOutline(l)) ?? o
    : placeObstacle(resized, ...center, l.widthM, l.heightM, l.gridM);
  return !obstacleFitsRoom(n, l.widthM, l.heightM) || !footprintFits(n, l.floorPolygon) || hits(l, n, 0, id) ? l : { ...l, walkways: undefined, obstacles: l.obstacles.map((x) => (x.id === id ? n : x)) };
}

/** Đổi kích thước tường bao: kẹp lại vật cản, khoá lại cửa vào tường, snap lại camera, xoá cọ tô (lưới đổi). */
export function resizeRoom(l: Layout, W: number, H: number): Layout {
  if (!Number.isFinite(W) || !Number.isFinite(H)) return l;
  const w = round2(clamp(snap(W, l.gridM), 3, 40)), h = round2(clamp(snap(H, l.gridM), 3, 40));
  if (Math.ceil(w / l.gridM) * Math.ceil(h / l.gridM) > 12000) return l;
  const floorPolygon = l.floorPolygon?.map(([x, y]) => [x * w / l.widthM, y * h / l.heightM] as [number, number]);
  const obstacles = l.obstacles.map((o) => placeObstacle(o, (o.x + o.w / 2) * (floorPolygon ? w / l.widthM : 1), (o.y + o.h / 2) * (floorPolygon ? h / l.heightM : 1), w, h, l.gridM));
  if (obstacles.some((o, i) => !obstacleFitsRoom(o, w, h) || !footprintFits(o, floorPolygon) || obstacles.slice(i + 1).some((other) => satCollide(obsPoly(o), obsPoly(other))))) return l;
  const cameras: Camera[] = l.cameras.map((c) => { const [x, y] = snapToWall(c.x, c.y, w, h, l.gridM, floorPolygon); return { ...c, x, y }; });
  return { ...l, widthM: w, heightM: h, floorPolygon, walkways: undefined, obstacles, cameras, risk: {}, riskStrokes: [] };
}
