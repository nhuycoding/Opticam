import { PERSON_TARGETS, type Camera, type Layout, type Obstacle, type RiskStroke, type Score, type ShelfRiskCategory } from '../types';
import { buildBom } from './bom';
import { clamp, norm360, obstacleFitsRoom } from './geometry';
import { SHELF_RISK_PROFILES } from './optics';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const TYPES = ['shelf', 'pos', 'entrance'];

/** Chấp nhận nhiều tên khoá (pan | pan_angle | angle) để khớp schema backend. */
export function normalizeCameras(list: any[], widthM: number, heightM: number): Camera[] {
  if (!Array.isArray(list)) throw new Error('Danh sách camera không hợp lệ.');
  if (list.length > 20) throw new Error('Mỗi mặt bằng hỗ trợ tối đa 20 camera.');
  const ids = new Set<string>();
  return list.map((c: any, i: number): Camera => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`Camera #${i + 1} không hợp lệ.`);
    let id = String(c.id ?? `CAM-${String(i + 1).padStart(2, '0')}`);
    if (!id || ids.has(id)) id = `CAM-${String(i + 1).padStart(2, '0')}`;
    while (ids.has(id)) id += '-copy';
    ids.add(id);
    return {
      id, x: clamp(num(c.x, 0), 0, widthM), y: clamp(num(c.y, 0), 0, heightM),
      pan: norm360(num(c.pan ?? c.pan_angle ?? c.angle, 0)),
      fov: clamp(num(c.fov, 85), 30, 140), res: clamp(num(c.res, 2560), 640, 7680),
      range: clamp(num(c.range, 10), 1, 30), height: clamp(num(c.height, 2.4), 1.8, 4),
      target: typeof c.target === 'string' ? c.target : undefined,
      model: typeof c.model === 'string' ? c.model : undefined
    };
  });
}

/** Chuẩn hoá & kiểm tra toàn vẹn dữ liệu; chấp nhận cả file xuất cũ của bản Pygame (width/height/pan_angle...). */
export function normalizeLayout(raw: any): Layout {
  const L = raw?.layout ?? raw;
  if (!L || typeof L !== 'object' || !Array.isArray(L.obstacles)) throw new Error('File không đúng định dạng layout OptiCam.');
  const widthM = num(L.widthM ?? L.width, 10), heightM = num(L.heightM ?? L.height, 6);
  if (widthM < 3 || heightM < 3 || widthM > 40 || heightM > 40) throw new Error('Kích thước mặt bằng ngoài khoảng 3–40 m.');
  const gridM = num(L.gridM ?? L.grid_size, 0.5);
  if (gridM < 0.1 || gridM > 2) throw new Error('Kích thước ô phải trong khoảng 0,1–2 m.');
  if (Math.ceil(widthM / gridM) * Math.ceil(heightM / gridM) > 12000) throw new Error('Mặt bằng vượt giới hạn 12.000 ô. Hãy tăng kích thước ô.');
  if (L.obstacles.length > 500) throw new Error('Mặt bằng hỗ trợ tối đa 500 vật cản.');
  if (Array.isArray(L.riskStrokes) && L.riskStrokes.length > 50000) throw new Error('Số nét cọ vượt giới hạn 50.000.');
  const obstacleIds = new Set<string>();
  const obstacles: Obstacle[] = L.obstacles.map((o: any, i: number): Obstacle => {
    if (!o || typeof o !== 'object') throw new Error(`Vật cản #${i + 1} không hợp lệ.`);
    if (!TYPES.includes(o.type)) throw new Error(`Vật cản #${i + 1}: loại "${o.type}" không hợp lệ.`);
    const defaults = o.type === 'shelf' ? { wmax: 3, r0: 1, radius: 2 } : { wmax: 5, r0: 1, radius: 2.5 };
    const categoryValues: ShelfRiskCategory[] = ['high', 'standard', 'bulky', 'custom'];
    const hasRiskWmax = typeof o.riskWmax === 'number' && Number.isFinite(o.riskWmax);
    const riskCategory: ShelfRiskCategory | undefined = o.type !== 'shelf'
      ? undefined
      : categoryValues.includes(o.riskCategory)
        ? o.riskCategory
        : hasRiskWmax && Math.abs(o.riskWmax - SHELF_RISK_PROFILES.standard.wmax) > 1e-9
          ? 'custom'
          : 'standard';
    const defaultWmax = o.type === 'shelf'
      ? SHELF_RISK_PROFILES[riskCategory ?? 'standard'].wmax
      : defaults.wmax;
    const riskR0 = Math.max(0, num(o.riskR0, defaults.r0));
    const id = String(o.id || `obs_${i}`);
    if (obstacleIds.has(id)) throw new Error(`Mã vật cản bị trùng ${id}.`);
    obstacleIds.add(id);
    const obstacle: Obstacle = {
      id, type: o.type, label: String(o.label ?? o.name ?? o.type),
      x: num(o.x, 0), y: num(o.y, 0), w: num(o.w ?? o.width, 1), h: num(o.h ?? o.height, 1),
      elev: num(o.elev ?? o.elevation, o.type === 'shelf' ? 1.8 : 1.1), angle: num(o.angle, 0),
      ...(riskCategory ? { riskCategory } : {}),
      riskWmax: Math.min(5, Math.max(1, num(o.riskWmax, defaultWmax))),
      riskR0,
      riskR: Math.max(riskR0 + 0.1, num(o.riskR, defaults.radius))
    };
    if (obstacle.w <= 0 || obstacle.h <= 0 || obstacle.elev < 0 || !obstacleFitsRoom(obstacle, widthM, heightM)) {
      throw new Error(`Vật cản #${i + 1} có kích thước hoặc vị trí ngoài mặt bằng.`);
    }
    return obstacle;
  });
  const cameras = normalizeCameras(L.cameras ?? [], widthM, heightM);
  const targetHeight = PERSON_TARGETS.find((target) => target.height === L.targetHeight)?.height ?? 1.6;
  const riskStrokes: RiskStroke[] = Array.isArray(L.riskStrokes)
    ? L.riskStrokes.filter((stroke: any) => Number.isFinite(stroke?.x) && Number.isFinite(stroke?.y) &&
      Number.isFinite(stroke?.radius) && stroke.radius > 0 && Number.isFinite(stroke?.weight))
      .map((stroke: any) => ({
        x: num(stroke.x, 0), y: num(stroke.y, 0), radius: num(stroke.radius, 0.25),
        weight: clamp(num(stroke.weight, 1), 1, 5)
      }))
    : [];
  const legacyStrokes = Object.entries(L.risk && typeof L.risk === 'object' ? L.risk : {})
    .flatMap(([key, value]) => {
      const match = /^(\d+)_(\d+)$/.exec(key);
      if (!match || typeof value !== 'number' || !Number.isFinite(value)) return [];
      const row = Number(match[1]), col = Number(match[2]), gridM = num(L.gridM ?? L.grid_size, 0.5);
      return [{ x: (col + 0.5) * gridM, y: (row + 0.5) * gridM, radius: gridM / Math.SQRT2, weight: clamp(value, 1, 5) }];
    });
  const bg = L.background ?? undefined;
  if (bg !== undefined && (!bg || typeof bg !== 'object' || typeof bg.dataUrl !== 'string' ||
      !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(bg.dataUrl) ||
      !Number.isFinite(bg.widthM) || bg.widthM <= 0 || !Number.isFinite(bg.opacity))) {
    throw new Error('Ảnh nền trong file không hợp lệ.');
  }
  return {
    version: String(L.version ?? '1.0'), name: String(L.name ?? 'Layout'), widthM, heightM,
    gridM, pixelsPerMeter: clamp(num(L.pixelsPerMeter, 68), 30, 120), targetHeight,
    background: bg ? { dataUrl: bg.dataUrl, widthM: clamp(bg.widthM, 0.1, 400), opacity: clamp(bg.opacity, 0, 1), visible: bg.visible !== false } : undefined, obstacles, risk: {}, riskStrokes: [...legacyStrokes, ...riskStrokes], cameras
  };
}

export function download(name: string, data: string | Blob, mime = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bundle dự án: Layout + Camera + Risk + Score + BOM. */
export const exportBundle = (l: Layout, score: Score) =>
  JSON.stringify({ format: 'opticam-bundle', version: '1.0', exportedAt: new Date().toISOString(), layout: l, score, bom: buildBom(l) }, null, 2);

export function parseBundle(text: string): Layout {
  if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error('File JSON vượt giới hạn 5 MB.');
  try {
    return normalizeLayout(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Nội dung JSON không hợp lệ.');
    throw error;
  }
}
