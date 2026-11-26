import type { Camera } from '../types';
import { cameraProjection } from './camera';
import { rad, type Pt } from './geometry';
import { rayFloorDistance } from './footprint';

/** Intersection of the target-height plane, a perspective frustum and slant range.
 * Furniture occlusion is evaluated separately by the DORI heatmap. */
export function cameraFootprint(camera: Camera, targetHeight = 1.6, floorPolygon?: Pt[]): Pt[] {
  const dz = targetHeight - camera.height;
  if (!Number.isFinite(camera.range) || camera.range <= Math.abs(dz)) return [];
  const radius = Math.sqrt(camera.range ** 2 - dz ** 2);
  const { tilt, vfov } = cameraProjection(camera);
  const pan = rad(camera.pan), pitch = rad(tilt);
  const cp = Math.cos(pan), sp = Math.sin(pan), ct = Math.cos(pitch), st = Math.sin(pitch);
  const tanH = Math.tan(rad(camera.fov / 2)), tanV = Math.tan(rad(vfov / 2));
  const coordinates = ([x, y]: Pt) => {
    const dx = x - camera.x, dy = y - camera.y, along = dx * cp + dy * sp;
    return { depth: along * ct - dz * st, right: -dx * sp + dy * cp, up: along * st + dz * ct };
  };
  const angles = Array.from({ length: 128 }, (_, index) => index * 2 * Math.PI / 128);
  // Rays immediately either side of each corner keep exterior notches occluded.
  // Regular rays approximate only the circular range boundary, not room edges.
  if (floorPolygon) for (const [x, y] of floorPolygon) {
    const angle = Math.atan2(y - camera.y, x - camera.x);
    for (const delta of [-1e-7, 0, 1e-7]) angles.push((angle + delta + Math.PI * 2) % (Math.PI * 2));
  }
  angles.sort((a, b) => a - b);
  let polygon: Pt[] = angles.map(angle => {
    const distance = floorPolygon ? rayFloorDistance([camera.x, camera.y], angle, radius, floorPolygon) : radius;
    return [camera.x + distance * Math.cos(angle), camera.y + distance * Math.sin(angle)];
  });
  const planes = [
    (point: Pt) => coordinates(point).depth - 1e-8,
    (point: Pt) => { const c = coordinates(point); return c.depth * tanH + c.right; },
    (point: Pt) => { const c = coordinates(point); return c.depth * tanH - c.right; },
    (point: Pt) => { const c = coordinates(point); return c.depth * tanV + c.up; },
    (point: Pt) => { const c = coordinates(point); return c.depth * tanV - c.up; }
  ];
  for (const distance of planes) {
    const clipped: Pt[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const da = distance(a), db = distance(b), aInside = da >= 0, bInside = db >= 0;
      if (aInside) clipped.push(a);
      if (aInside !== bInside) {
        const t = da / (da - db);
        clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    polygon = clipped;
    if (!polygon.length) break;
  }
  return polygon;
}
