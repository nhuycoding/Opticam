import type { Layout, Obstacle } from '../types';
import { obsPoly, type Pt } from './geometry';

export const floorOutline = (layout: Pick<Layout, 'widthM' | 'heightM' | 'floorPolygon'>): Pt[] =>
  layout.floorPolygon ?? [[0, 0], [layout.widthM, 0], [layout.widthM, layout.heightM], [0, layout.heightM]];

export function projectToSegment(point: Pt, start: Pt, end: Pt): { point: Pt; t: number; distance: number } {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  const projected: Pt = [start[0] + t * dx, start[1] + t * dy];
  return { point: projected, t, distance: Math.hypot(point[0] - projected[0], point[1] - projected[1]) };
}

export function pointInFloor(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (projectToSegment(point, a, b).distance < 1e-7) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Split at wall crossings so sightlines cannot travel through an exterior notch. */
export function segmentInFloor(a: Pt, b: Pt, polygon: Pt[]): boolean {
  if (!pointInFloor(a, polygon) || !pointInFloor(b, polygon)) return false;
  const times = [0, 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    const ex = d[0] - c[0], ey = d[1] - c[1], denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-10) continue;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) times.push(t);
  }
  times.sort((x, y) => x - y);
  return times.slice(1).every((time, i) => {
    const t = (time + times[i]) / 2;
    return pointInFloor([a[0] + t * dx, a[1] + t * dy], polygon);
  });
}

export function footprintFits(obstacle: Obstacle, polygon?: Pt[]): boolean {
  if (!polygon) return true;
  const points = obsPoly(obstacle);
  return points.every((point, i) => segmentInFloor(point, points[(i + 1) % points.length], polygon)) && pointInFloor([obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2], polygon);
}

export function floorArea(layout: Pick<Layout, 'widthM' | 'heightM' | 'floorPolygon'>): number {
  const polygon = floorOutline(layout);
  return Math.round(Math.abs(polygon.reduce((sum, p, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + p[0] * next[1] - p[1] * next[0];
  }, 0)) * 50) / 100;
}

export function boundaryAnchors(polygon: Pt[], step: number): Pt[] {
  const points = new Map<string, Pt>();
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / step));
    for (let j = 0; j <= count; j++) {
      const point: Pt = [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count];
      points.set(point.map(value => value.toFixed(8)).join('_'), point);
    }
  }
  return [...points.values()];
}

export function snapToBoundary(point: Pt, polygon: Pt[], step: number): Pt {
  let best = { point: polygon[0], distance: Infinity };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const projection = projectToSegment(point, a, b);
    if (projection.distance >= best.distance) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / step));
    const t = Math.round(projection.t * count) / count;
    best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], distance: projection.distance };
  }
  return best.point;
}

export function validateFloorPolygon(raw: unknown, width: number, height: number): Pt[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 32 || raw.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 0 || p[1] < 0 || p[0] > width || p[1] > height)) throw new Error('Đường bao cần 3–32 đỉnh nằm trong kích thước mặt bằng.');
  const polygon = raw as Pt[];
  const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < .01) throw new Error('Các đỉnh đường bao không được trùng nhau.');
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      const c = polygon[j], d = polygon[(j + 1) % polygon.length];
      if (orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0 && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))) throw new Error('Đường bao không được tự giao nhau.');
    }
  }
  if (floorArea({ widthM: width, heightM: height, floorPolygon: polygon }) < 1) throw new Error('Diện tích đường bao quá nhỏ.');
  return polygon.map(([x, y]) => [x, y]);
}

/** Align a one-sided fixture with the nearest sufficiently long boundary edge. */
export function placeWallFixture(obstacle: Obstacle, center: Pt, polygon: Pt[]): Obstacle | null {
  const length = Math.max(obstacle.w, obstacle.h), depth = Math.min(obstacle.w, obstacle.h);
  let placed: Obstacle | null = null;
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (edgeLength < length) continue;
    const projection = projectToSegment(center, a, b);
    if (projection.distance >= nearest) continue;
    const ux = (b[0] - a[0]) / edgeLength, uy = (b[1] - a[1]) / edgeLength;
    const t = Math.max(length / 2, Math.min(edgeLength - length / 2, projection.t * edgeLength));
    const mx = a[0] + ux * t, my = a[1] + uy * t;
    const side = pointInFloor([mx - uy * .01, my + ux * .01], polygon) ? 1 : -1;
    const cx = mx - uy * (depth / 2 + .015) * side, cy = my + ux * (depth / 2 + .015) * side;
    const candidate = { ...obstacle, w: length, h: depth, x: cx - length / 2, y: cy - depth / 2, angle: Math.atan2(uy, ux) * 180 / Math.PI };
    if (!footprintFits(candidate, polygon)) continue;
    placed = candidate; nearest = projection.distance;
  }
  return placed;
}

/** Distance to the first wall in a direction, measured in the polygon's units. */
export function rayFloorDistance(origin: Pt, angle: number, radius: number, polygon: Pt[]): number {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  if (!pointInFloor([origin[0] + dx * 1e-5, origin[1] + dy * 1e-5], polygon)) return 0;
  let nearest = radius;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-10) continue;
    const t = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / denominator;
    const u = ((a[0] - origin[0]) * dy - (a[1] - origin[1]) * dx) / denominator;
    if (t > 1e-7 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
  }
  return nearest;
}
