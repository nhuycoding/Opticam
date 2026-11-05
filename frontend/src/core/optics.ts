import type { Camera, Cell, Dori, Layout, Score, Weight, Zone } from '../types';
import { deg, distToObs, norm360, obsPoly, rad, rayBlocked, type Pt } from './geometry';

/** Ngưỡng DORI theo IEC 62676-4 (PPM) */
export const DORI_MIN = { identification: 250, recognition: 125, observation: 62, detection: 25 } as const;
export const DORI_FACTOR: Record<Dori, number> = { identification: 1, recognition: 0.75, observation: 0.4, detection: 0.2, blind: 0 };
/** Mức DORI tối thiểu theo trọng số rủi ro: Đỏ 250 / Vàng 125 / Xanh 62 */
export const REQUIRED_PPM: Record<Weight, number> = { 5: 250, 3: 125, 1: 62 };
export const FACE_Z = 1.6;            // mặt phẳng khuôn mặt (m)
export const RED_BUFFER = 1.0;        // vùng đệm quanh POS / cửa (m)
export const YELLOW_BUFFER = 1.0;     // vùng đệm hành lang quanh kệ (m)

export const doriOf = (ppm: number): Dori =>
  ppm >= DORI_MIN.identification ? 'identification' : ppm >= DORI_MIN.recognition ? 'recognition'
  : ppm >= DORI_MIN.observation ? 'observation' : ppm >= DORI_MIN.detection ? 'detection' : 'blind';

/** Vật cản chắn tầm nhìn khuôn mặt: kệ cao ≥ 1.6m (POS 1.1m và cửa không chắn). */
export const blockerPolys = (l: Layout): Pt[][] => l.obstacles.filter((o) => o.type === 'shelf' && o.elev >= FACE_Z).map(obsPoly);

/** PPM = Res_H / (2·r·tan(FOV/2)), r tính trên mặt phẳng khuôn mặt Z = 1.6m; 0 nếu ngoài FOV / bị kệ che. */
export function ppmAt(cam: Camera, x: number, y: number, polys: Pt[][]): number {
  const dx = x - cam.x, dy = y - cam.y, d = Math.hypot(dx, dy);
  if (d < 0.2 || d > cam.range) return 0;
  let diff = Math.abs(norm360(deg(Math.atan2(dy, dx))) - cam.pan);
  if (diff > 180) diff = 360 - diff;
  if (diff > cam.fov / 2) return 0;
  if (rayBlocked([cam.x, cam.y], [x, y], polys)) return 0;
  const r = Math.hypot(d, Math.max(0, cam.height - FACE_Z));
  return cam.res / (2 * r * Math.tan(rad(cam.fov / 2)));
}

/** Rule-based Semantic Object Mapping + Manual Risk Brush → lưới ô 0.5m × 0.5m. Chỉ phụ thuộc vật cản/cọ tô, không phụ thuộc camera. */
export function buildZones(l: Layout): Zone[] {
  const cols = Math.round(l.widthM / l.gridM), rows = Math.round(l.heightM / l.gridM);
  const critical = l.obstacles.filter((o) => o.type === 'pos' || o.type === 'entrance');
  const shelves = l.obstacles.filter((o) => o.type === 'shelf');
  const zones: Zone[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = (c + 0.5) * l.gridM, cy = (r + 0.5) * l.gridM;
    const solid = l.obstacles.some((o) => o.type !== 'entrance' && distToObs(cx, cy, o) < 1e-9);
    let w: Weight = 1;
    if (critical.some((o) => distToObs(cx, cy, o) <= RED_BUFFER)) w = 5;
    else if (shelves.some((o) => distToObs(cx, cy, o) <= YELLOW_BUFFER)) w = 3;
    zones.push({ r, c, cx, cy, w: l.risk[`${r}_${c}`] ?? w, solid });
  }
  return zones;
}

export function evaluate(l: Layout, zones: Zone[]): { cells: Cell[]; score: Score } {
  const t0 = performance.now();
  const polys = blockerPolys(l);
  let redN = 0, redOk = 0, yelN = 0, yelOk = 0, weighted = 0;
  const cells: Cell[] = zones.map((z) => {
    if (z.solid) return { ...z, ppm: 0, dori: 'blind' as Dori };
    let ppm = 0;
    for (const cam of l.cameras) ppm = Math.max(ppm, ppmAt(cam, z.cx, z.cy, polys));
    const dori = doriOf(ppm);
    if (z.w === 5) { redN++; if (ppm >= DORI_MIN.identification) redOk++; }
    else if (z.w === 3) { yelN++; if (ppm >= DORI_MIN.recognition) yelOk++; }
    weighted += z.w * DORI_FACTOR[dori];
    return { ...z, ppm, dori };
  });
  const pct = (a: number, n: number) => (n ? Math.round((a / n) * 1000) / 10 : 100);
  return {
    cells,
    score: { red: pct(redOk, redN), yellow: pct(yelOk, yelN), weighted: Math.round(weighted * 10) / 10, cams: l.cameras.length, ms: Math.round((performance.now() - t0) * 100) / 100 }
  };
}
