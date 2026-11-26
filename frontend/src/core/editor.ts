import { cameraMount } from './camera';
import { placeEditedCamera } from './cameraEditing';
import { applyTiersToObstacle, defaultTiersForObstacle } from './craved';
import { FIXTURE_SPECS } from './fixtures';
import { footprintFits, floorOutline, placeWallFixture, validateFloorPolygon } from './footprint';
import type { Camera, Fixture, Layout, Obstacle, ObsType, Person } from '../types';
import { clamp, obstacleFitsRoom, obsPoly, placeObstacle, rad, round2, satCollide, snap, snapAngle, snapToWall, type Pt } from './geometry';

export const TEMPLATES: Record<ObsType, Omit<Obstacle, 'id' | 'x' | 'y'>> = {
  shelf: { type: 'shelf', label: 'Kệ hàng', w: 4, h: 0.5, elev: 1.8, angle: 0, riskCategory: 'standard' },
  pos: { type: 'pos', label: 'Quầy POS', w: 2, h: 1, elev: 1.1, angle: 0 },
  entrance: { type: 'entrance', label: 'Cửa chính', w: 1.5, h: 0.2, elev: 2.2, angle: 0 }
};
export const AREA_MIN = 50, AREA_MAX = 80;

type PlacementLayout = Pick<Layout, 'widthM' | 'heightM' | 'gridM' | 'floorPolygon' | 'obstacles'>;

const fitsFloor = (layout: PlacementLayout, obstacle: Obstacle) =>
  obstacleFitsRoom(obstacle, layout.widthM, layout.heightM) && footprintFits(obstacle, layout.floorPolygon);

/** Preserve a manually rotated wall shelf's angle while dragging it away from its wall. */
function staysWallAligned(layout: PlacementLayout, obstacle: Obstacle): boolean {
  if (obstacle.fixture !== 'wall-shelf') return false;
  const aligned = placeWallFixture(obstacle, [obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2], floorOutline(layout));
  return Boolean(aligned && Math.abs(Math.sin((aligned.angle - obstacle.angle) * Math.PI / 180)) < 1e-6);
}

/** Shared placement for plan and 3D dragging. Existing intersections can be moved apart. */
export function placeMovedObstacle(layout: PlacementLayout, obstacle: Obstacle, centerX: number, centerY: number): Obstacle | null {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;
  const next = staysWallAligned(layout, obstacle) || (obstacle.type === 'entrance' && layout.floorPolygon)
    ? placeWallFixture(obstacle, [centerX, centerY], floorOutline(layout))
    : placeObstacle(obstacle, centerX, centerY, layout.widthM, layout.heightM, layout.gridM);
  if (!next || !fitsFloor(layout, next)) return null;
  const originalPolygon = obsPoly(obstacle), nextPolygon = obsPoly(next);
  const newCollision = layout.obstacles.some(other => other.id !== obstacle.id &&
    satCollide(nextPolygon, obsPoly(other)) && !satCollide(originalPolygon, obsPoly(other)));
  return newCollision ? null : next;
}

export function moveObstacle(layout: Layout, id: string, centerX: number, centerY: number): Layout {
  const obstacle = layout.obstacles.find(item => item.id === id);
  if (!obstacle) return layout;
  const next = placeMovedObstacle(layout, obstacle, centerX, centerY);
  if (!next || next.x === obstacle.x && next.y === obstacle.y && next.angle === obstacle.angle) return layout;
  return { ...layout, walkways: undefined, obstacles: layout.obstacles.map(item => item.id === id ? next : item) };
}

/** Rotate solid furniture freely through other furniture, retaining the actual floor boundary. */
export function rotateObstacle(layout: Layout, id: string, dir: 1 | -1): Layout {
  const obstacle = layout.obstacles.find(item => item.id === id);
  if (!obstacle || obstacle.type === 'entrance') return layout;
  const rotated = { ...obstacle, angle: snapAngle(obstacle.angle + dir * 15) };
  const centerX = obstacle.x + obstacle.w / 2, centerY = obstacle.y + obstacle.h / 2;
  let next = placeObstacle(rotated, centerX, centerY, layout.widthM, layout.heightM, layout.gridM);
  if (!fitsFloor(layout, next)) {
    // A concave or sloping wall may require a small inward shift after rotation.
    const positions: { x: number; y: number; distance: number }[] = [];
    for (let y = 0; y <= layout.heightM; y += layout.gridM) {
      for (let x = 0; x <= layout.widthM; x += layout.gridM) positions.push({ x, y, distance: (x - centerX) ** 2 + (y - centerY) ** 2 });
    }
    positions.sort((a, b) => a.distance - b.distance);
    let fit: Obstacle | undefined;
    for (const position of positions) {
      const candidate = placeObstacle(rotated, position.x, position.y, layout.widthM, layout.heightM, layout.gridM);
      if (fitsFloor(layout, candidate)) { fit = candidate; break; }
    }
    if (!fit) return layout;
    next = fit;
  }
  return { ...layout, walkways: undefined, obstacles: layout.obstacles.map(item => item.id === id ? next : item) };
}

const hits = (l: Layout, o: Obstacle, margin = 0, ignore?: string) => {
  const inflated = { ...o, x: o.x - margin, y: o.y - margin, w: o.w + 2 * margin, h: o.h + 2 * margin };
  return l.obstacles.some((q) => q.id !== ignore && satCollide(obsPoly(inflated), obsPoly(q)));
};

export interface PlacementDraft {
  type: ObsType;
  fixture?: Fixture;
  label: string;
  w: number;
  h: number;
  elev: number;
  angle: number;
}

export function makePlacementDraft(type: ObsType, fixture?: Fixture, ceilingHeight = 3.2): PlacementDraft {
  const spec = type === 'shelf' && fixture ? FIXTURE_SPECS[fixture] : undefined;
  const tpl = TEMPLATES[type];
  return {
    type,
    ...(type === 'shelf' && fixture ? { fixture } : {}),
    label: spec?.label ?? tpl.label,
    w: spec?.w ?? tpl.w,
    h: spec?.h ?? tpl.h,
    elev: Math.min(spec?.elev ?? tpl.elev, ceilingHeight),
    angle: 0,
  };
}

function buildTypedBase(l: Layout, type: ObsType, fixture?: Fixture, draft?: Partial<PlacementDraft>): Obstacle {
  let i = l.obstacles.length + 1;
  while (l.obstacles.some((o) => o.id === `${type}_${i}`)) i++;
  const spec = type === 'shelf' && fixture ? FIXTURE_SPECS[fixture] : undefined;
  let base: Obstacle = {
    ...TEMPLATES[type],
    ...(spec && fixture ? {
      label: spec.label,
      w: spec.w,
      h: spec.h,
      elev: Math.min(spec.elev, l.ceilingHeight ?? 3.2),
      fixture,
      riskCategory: spec.defaultRiskCategory,
      ...(spec.defaultWmax !== undefined ? { riskWmax: spec.defaultWmax, riskCategory: 'custom' as const } : {}),
    } : {}),
    ...(draft ? { label: draft.label ?? TEMPLATES[type].label, w: draft.w ?? TEMPLATES[type].w, h: draft.h ?? TEMPLATES[type].h, elev: draft.elev ?? TEMPLATES[type].elev, angle: draft.angle ?? 0 } : {}),
    id: `${type}_${i}`,
    x: 0,
    y: 0,
  };
  if (type === 'shelf') {
    const tiers = defaultTiersForObstacle(base);
    if (tiers.length) base = { ...base, ...applyTiersToObstacle(base, tiers) };
  }
  return base;
}

/** Preview & validate exact cursor placement for a fixture draft on the 2.5D plan. */
export function buildObstacleFromDraft(
  l: Layout,
  draft: PlacementDraft,
  centerX: number,
  centerY: number
): { obstacle: Obstacle; valid: boolean } {
  const base = buildTypedBase(l, draft.type, draft.fixture, draft);
  const { widthM: W, heightM: H } = l;
  let placed: Obstacle | null = null;
  if (draft.type === 'entrance') {
    placed = l.floorPolygon
      ? placeWallFixture(base, [centerX, centerY], l.floorPolygon)
      : placeObstacle(base, centerX, centerY, W, H, 0.05);
  } else if (draft.fixture === 'wall-shelf' && draft.angle === 0) {
    placed = placeWallFixture(base, [centerX, centerY], floorOutline(l));
  } else {
    const cx = clamp(snap(centerX, 0.1), 0.1, W - 0.1);
    const cy = clamp(snap(centerY, 0.1), 0.1, H - 0.1);
    placed = placeObstacle(base, cx, cy, W, H, 0.05);
  }
  const obstacle = placed ?? { ...base, x: round2(clamp(centerX - base.w / 2, 0, Math.max(0, W - base.w))), y: round2(clamp(centerY - base.h / 2, 0, Math.max(0, H - base.h))) };
  const valid = Boolean(
    placed &&
    obstacleFitsRoom(placed, W, H) &&
    footprintFits(placed, l.floorPolygon) &&
    !hits(l, placed, 0)
  );
  return { obstacle, valid };
}

/** Thêm khối vào vị trí ngữ nghĩa hợp lý trên mặt bằng (ưu tiên cạnh POS/gondola/tường). Trả null nếu hết chỗ. */
export function addObstacle(l: Layout, type: ObsType, fixture?: Fixture): Layout | null {
  const base = buildTypedBase(l, type, fixture);
  const spec = type === 'shelf' && fixture ? FIXTURE_SPECS[fixture] : undefined;
  const { widthM: W, heightM: H, gridM: g } = l;
  if (type === 'shelf' && fixture === 'wall-shelf') {
    const shelf = base;
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
  const pos = l.obstacles.find((o) => o.type === 'pos');
  const door = l.obstacles.find((o) => o.type === 'entrance');
  const gondola = l.obstacles.find((o) => o.type === 'shelf' && (!o.fixture || o.fixture === 'gondola'));
  const preferWall = type === 'pos' || spec?.placement === 'near-wall';

  const key = (p: [number, number]) => {
    if (fixture === 'checkout-rack' && pos) {
      return Math.hypot(p[0] - (pos.x + pos.w / 2), p[1] - (pos.y + pos.h + 0.55));
    }
    if (fixture === 'endcap' && gondola) {
      return Math.min(
        Math.hypot(p[0] - (gondola.x + gondola.w / 2), p[1] - (gondola.y - 0.55)),
        Math.hypot(p[0] - (gondola.x + gondola.w / 2), p[1] - (gondola.y + gondola.h + 0.55))
      );
    }
    if ((fixture === 'locker' || fixture === 'seating') && door) {
      return wall(p) + Math.hypot(p[0] - (door.x + door.w / 2), p[1] - (door.y + door.h / 2)) * 0.5;
    }
    if (preferWall) {
      const doorPenalty = door && Math.hypot(p[0] - (door.x + door.w / 2), p[1] - (door.y + door.h / 2)) < 1.6 ? 4 : 0;
      return wall(p) + doorPenalty;
    }
    return Math.hypot(p[0] - W / 2, p[1] - H / 2) + (type === 'shelf' && wall(p) < 1 ? 1000 : 0);
  };
  pts.sort((a, b) => key(a) - key(b));
  for (const margin of type === 'shelf' ? [0.5, 0] : [0]) for (const [cx, cy] of pts) {
    const n = type === 'entrance' && l.floorPolygon ? placeWallFixture(base, [cx,cy], l.floorPolygon) ?? base : placeObstacle(base, cx, cy, W, H, g);
    if (obstacleFitsRoom(n, W, H) && footprintFits(n, l.floorPolygon) && !hits(l, n, margin)) return { ...l, obstacles: [...l.obstacles, n], walkways: undefined };
  }
  return null;
}

export const removeObstacle = (l: Layout, id: string): Layout => ({ ...l, walkways: undefined, obstacles: l.obstacles.filter((o) => o.id !== id) });

/** Đổi kích thước mượt không giật lưới; tự đẩy nhẹ khỏi mép tường khi phóng to, từ chối nếu gây chồng lấn. */
export function resizeObstacle(l: Layout, id: string, w: number, h: number, options?: { anchorTopLeft?: boolean }): Layout {
  const o = l.obstacles.find((x) => x.id === id);
  if (!o || !Number.isFinite(w) || !Number.isFinite(h)) return l;
  const nextW = round2(clamp(w, 0.2, l.widthM));
  const nextH = round2(clamp(h, 0.2, l.heightM));
  const resized = { ...o, w: nextW, h: nextH };
  const center: [number, number] = [o.x + o.w / 2, o.y + o.h / 2];

  let candidate: Obstacle | null = null;
  if (o.type === 'entrance' && l.floorPolygon) {
    candidate = placeWallFixture(resized, center, floorOutline(l));
  } else if (o.type === 'entrance') {
    candidate = placeObstacle(resized, center[0], center[1], l.widthM, l.heightM, 0.05);
  } else if (staysWallAligned(l, o)) {
    candidate = placeWallFixture(resized, center, floorOutline(l));
  } else {
    const r = rad(o.angle);
    const dlx = options?.anchorTopLeft ? (nextW - o.w) / 2 : 0;
    const dly = options?.anchorTopLeft ? (nextH - o.h) / 2 : 0;
    const targetCx = center[0] + dlx * Math.cos(r) - dly * Math.sin(r);
    const targetCy = center[1] + dlx * Math.sin(r) + dly * Math.cos(r);
    const ex = (nextW / 2) * Math.abs(Math.cos(r)) + (nextH / 2) * Math.abs(Math.sin(r));
    const ey = (nextW / 2) * Math.abs(Math.sin(r)) + (nextH / 2) * Math.abs(Math.cos(r));
    if (ex * 2 <= l.widthM + 1e-6 && ey * 2 <= l.heightM + 1e-6) {
      const ncx = clamp(targetCx, ex, l.widthM - ex);
      const ncy = clamp(targetCy, ey, l.heightM - ey);
      candidate = { ...resized, x: round2(ncx - nextW / 2), y: round2(ncy - nextH / 2) };
    }
  }

  if (!candidate || !obstacleFitsRoom(candidate, l.widthM, l.heightM) || !footprintFits(candidate, l.floorPolygon)) return l;
  if (hits(l, candidate, 0, id)) return l;
  return { ...l, walkways: undefined, obstacles: l.obstacles.map((x) => (x.id === id ? candidate : x)) };
}

/** Đổi kích thước tường bao: kẹp lại vật cản, khoá lại cửa vào tường, snap lại camera, xoá cọ tô (lưới đổi). */
export function resizeRoom(l: Layout, W: number, H: number): Layout {
  if (!Number.isFinite(W) || !Number.isFinite(H)) return l;
  const w = round2(clamp(snap(W, l.gridM), 3, 40)), h = round2(clamp(snap(H, l.gridM), 3, 40));
  if (Math.ceil(w / l.gridM) * Math.ceil(h / l.gridM) > 12000) return l;
  const floorPolygon = l.floorPolygon?.map(([x, y]) => [x * w / l.widthM, y * h / l.heightM] as [number, number]);
  const obstacles = l.obstacles.map((o) => placeObstacle(o, (o.x + o.w / 2) * (floorPolygon ? w / l.widthM : 1), (o.y + o.h / 2) * (floorPolygon ? h / l.heightM : 1), w, h, l.gridM));
  if (obstacles.some((o, i) => !obstacleFitsRoom(o, w, h) || !footprintFits(o, floorPolygon) || obstacles.slice(i + 1).some((other) => satCollide(obsPoly(o), obsPoly(other))))) return l;
  const resizedLayout = { ...l, widthM: w, heightM: h, floorPolygon, obstacles };
  const cameras: Camera[] = [];
  for (const camera of l.cameras) {
    if (cameraMount(camera) === 'ceiling') {
      const placed = placeEditedCamera({ ...camera, x: camera.x * w / l.widthM, y: camera.y * h / l.heightM }, resizedLayout);
      if (!placed) return l;
      cameras.push(placed);
    } else {
      const [x, y] = snapToWall(camera.x, camera.y, w, h, l.gridM, floorPolygon);
      cameras.push({ ...camera, x, y });
    }
  }
  return { ...l, widthM: w, heightM: h, floorPolygon, walkways: undefined, obstacles, cameras, risk: {}, riskStrokes: [] };
}

/**
 * Rotate the entire floor plan (room dimensions, polygon, obstacles, cameras,
 * manual risk strokes, walkways, and static people) by 90 degrees clockwise:
 * `(x, y) -> (H - y, x)` so swapping Width <-> Height always fits cleanly.
 */
export function rotateLayout90(layout: Layout, people: Person[] = []): { layout: Layout; people: Person[] } {
  const oldH = layout.heightM;
  const newW = oldH;
  const newH = layout.widthM;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  const rotatePt = ([x, y]: Pt): Pt => [round4(clamp(oldH - y, 0, newW)), round4(clamp(x, 0, newH))];
  const floorPolygon = layout.floorPolygon ? layout.floorPolygon.map(rotatePt) : undefined;

  const obstacles = layout.obstacles.map((obs) => {
    const cx = obs.x + obs.w / 2;
    const cy = obs.y + obs.h / 2;
    const nextAngle = ((Math.round((obs.angle + 90) * 100) / 100) % 360 + 360) % 360;
    const r = rad(nextAngle);
    const ex = (obs.w / 2) * Math.abs(Math.cos(r)) + (obs.h / 2) * Math.abs(Math.sin(r));
    const ey = (obs.w / 2) * Math.abs(Math.sin(r)) + (obs.h / 2) * Math.abs(Math.cos(r));
    const ncx = clamp(oldH - cy, ex, Math.max(ex, newW - ex));
    const ncy = clamp(cx, ey, Math.max(ey, newH - ey));
    return {
      ...obs,
      x: round4(ncx - obs.w / 2),
      y: round4(ncy - obs.h / 2),
      angle: nextAngle,
    };
  });

  const cameras = layout.cameras.map((cam) => ({
    ...cam,
    x: round4(clamp(oldH - cam.y, 0, newW)),
    y: round4(clamp(cam.x, 0, newH)),
    pan: ((Math.round(cam.pan + 90) % 360) + 360) % 360,
  }));

  const riskStrokes = layout.riskStrokes.map((stroke) => ({
    ...stroke,
    x: round4(clamp(oldH - stroke.y, 0, newW)),
    y: round4(clamp(stroke.x, 0, newH)),
  }));

  const walkways = layout.walkways?.map((route) => ({
    ...route,
    points: route.points.map(rotatePt),
  }));

  const nextPeople = people.map((person) => ({
    ...person,
    x: round4(clamp(oldH - person.y, 0, newW)),
    y: round4(clamp(person.x, 0, newH)),
  }));

  return {
    layout: {
      ...layout,
      widthM: newW,
      heightM: newH,
      floorPolygon,
      obstacles,
      cameras,
      risk: {},
      riskStrokes,
      walkways,
    },
    people: nextPeople,
  };
}

/**
 * Construct an interior architectural wall / partition segment between two metric points `(a, b)`.
 * Allows corner/T-junction touching with other `partition` walls while blocking furniture overlaps.
 */
export function buildWallObstacle(
  layout: Pick<Layout, 'widthM' | 'heightM' | 'ceilingHeight' | 'floorPolygon' | 'obstacles'>,
  a: Pt,
  b: Pt,
  options: { thickness?: number; elev?: number; label?: string } = {},
): { obstacle: Obstacle; length: number; angle: number; valid: boolean } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const w = round2(Math.max(0.3, length));
  const ceiling = Number.isFinite(layout.ceilingHeight) ? Math.min(6, Math.max(2.4, layout.ceilingHeight!)) : 3.2;
  const h = round2(clamp(options.thickness ?? 0.2, 0.1, 0.6));
  const elev = round2(clamp(options.elev ?? ceiling, 0.4, ceiling));
  const rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const angle = Math.round((((rawDeg % 360) + 360) % 360) * 10) / 10;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;

  let idx = layout.obstacles.filter((o) => o.fixture === 'partition').length + 1;
  while (layout.obstacles.some((o) => o.id === `wall_${idx}`)) idx++;

  const obstacle: Obstacle = {
    id: `wall_${idx}`,
    type: 'shelf',
    fixture: 'partition',
    label: options.label ?? `Tường vách ${idx}`,
    x: round2(mx - w / 2),
    y: round2(my - h / 2),
    w,
    h,
    elev,
    angle,
    riskCategory: 'bulky',
    riskWmax: 1.0,
    riskR0: 0.2,
    riskR: 0.5,
  };

  const valid = length >= 0.3
    && obstacleFitsRoom(obstacle, layout.widthM, layout.heightM)
    && footprintFits(obstacle, layout.floorPolygon)
    && !layout.obstacles.some((other) => other.fixture !== 'partition' && satCollide(obsPoly(obstacle), obsPoly(other)));

  return { obstacle, length: round2(length), angle, valid };
}

export type CustomRoomShape = 'rect' | 'l-shape' | 'chamfer' | 'trapezoid';

export interface CustomLayoutConfig {
  name: string;
  shape: CustomRoomShape;
  widthM: number;
  heightM: number;
  gridM: number;
  ceilingHeight: number;
  turns90?: number;
  starterKit: 'empty' | 'basic';
}

export function polygonForRoomShape(shape: CustomRoomShape, w: number, h: number): Pt[] | undefined {
  if (shape === 'rect') return undefined;
  if (shape === 'l-shape') {
    const cutX = round2(w * 0.58);
    const cutY = round2(h * 0.42);
    return [[0, 0], [w, 0], [w, cutY], [cutX, cutY], [cutX, h], [0, h]];
  }
  if (shape === 'chamfer') {
    const c = round2(Math.min(w, h) * 0.25);
    return [[0, 0], [w - c, 0], [w, c], [w, h], [0, h]];
  }
  // trapezoid: slightly angled storefront at the top-right
  const inset = round2(Math.min(w * 0.18, 2.0));
  return [[0, 0], [w - inset, 0], [w, h], [0, h]];
}

/** Build a fresh user-defined store layout shell with optional starter door, POS, and corner cameras. */
export function buildCustomLayout(config: CustomLayoutConfig): { layout: Layout; people: Person[] } {
  const gridM = clamp(round2(config.gridM), 0.1, 2);
  const w = round2(clamp(snap(config.widthM, gridM), 3, 40));
  const h = round2(clamp(snap(config.heightM, gridM), 3, 40));
  const ceilingHeight = round2(clamp(config.ceilingHeight, 2.4, 6));
  const rawPoly = polygonForRoomShape(config.shape, w, h);
  const floorPolygon = rawPoly ? validateFloorPolygon(rawPoly, w, h) : undefined;

  const obstacles: Obstacle[] = [];
  if (config.starterKit === 'basic') {
    const doorW = round2(Math.min(1.5, Math.max(1.0, w * 0.2)));
    const doorX = round2(Math.min(0.6, Math.max(0.2, (w - doorW) * 0.15)));
    obstacles.push({
      id: 'ent_1',
      type: 'entrance',
      label: 'Cửa chính',
      x: doorX,
      y: 0,
      w: doorW,
      h: 0.2,
      elev: Math.min(2.2, ceilingHeight),
      angle: 0,
      riskWmax: 5,
      riskR0: 1.0,
      riskR: 2.5,
    });
    const posW = round2(Math.min(2.0, Math.max(1.4, w * 0.22)));
    const posH = round2(Math.min(1.0, Math.max(0.8, h * 0.16)));
    const posCandidate: Obstacle = {
      id: 'pos_1',
      type: 'pos',
      label: 'Quầy POS',
      x: round2(clamp(doorX + doorW + 0.5, 0.3, w - posW - 0.3)),
      y: round2(clamp(0.9, 0.3, h - posH - 0.3)),
      w: posW,
      h: posH,
      elev: Math.min(1.1, ceilingHeight),
      angle: 0,
      riskWmax: 5,
      riskR0: 1.0,
      riskR: 2.5,
    };
    if (footprintFits(posCandidate, floorPolygon) && obstacleFitsRoom(posCandidate, w, h)) {
      obstacles.push(posCandidate);
    }
  }

  const cameras: Camera[] = [];
  if (config.starterKit === 'basic') {
    const wallH = round2(Math.min(2.4, ceilingHeight - 0.3));
    const outline = floorOutline({ widthM: w, heightM: h, floorPolygon });
    const cornerSamples: Pt[] = outline.slice(0, 4);
    cornerSamples.forEach(([cx, cy], idx) => {
      const aimPan = ((Math.round(Math.atan2(h / 2 - cy, w / 2 - cx) * 180 / Math.PI / 15) * 15 % 360) + 360) % 360;
      cameras.push({
        id: `CAM-${String(idx + 1).padStart(2, '0')}`,
        x: round2(cx),
        y: round2(cy),
        pan: aimPan,
        fov: 85,
        res: 2560,
        range: 10,
        height: wallH,
        mount: 'wall',
        tilt: 20,
      });
    });
  }

  let result: { layout: Layout; people: Person[] } = {
    layout: {
      version: '1.0',
      name: config.name.trim() || 'Mặt bằng tự thiết kế',
      widthM: w,
      heightM: h,
      gridM,
      pixelsPerMeter: w > 18 || h > 14 ? 48 : 68,
      targetHeight: 1.6,
      ceilingHeight,
      optimization: { algorithm: 'kpi_hybrid', mounts: 'mixed', dualHeight: true },
      floorPolygon,
      obstacles,
      risk: {},
      riskStrokes: [],
      cameras,
    },
    people: [],
  };

  const turns = ((config.turns90 ?? 0) % 4 + 4) % 4;
  for (let i = 0; i < turns; i++) {
    result = rotateLayout90(result.layout, result.people);
  }
  return result;
}
