import type { Camera, Layout } from '../types';
import { cameraMount, normalizeCameraPlacement } from './camera';
import { floorOutline, pointInFloor } from './footprint';
import { clamp, distToObs, round2, snap, snapToWall } from './geometry';

/** Ceiling cameras need clearance around the lens, including at concave edges. */
export function canPlaceCeilingCamera(camera: Camera, layout: Layout): boolean {
  if (![camera.x, camera.y, camera.height].every(Number.isFinite)) return false;
  const polygon = floorOutline(layout);
  if (![[0, 0], [.12, 0], [-.12, 0], [0, .12], [0, -.12]].every(([dx, dy]) => pointInFloor([camera.x + dx, camera.y + dy], polygon))) return false;
  return !layout.obstacles.some(obstacle => obstacle.type !== 'entrance' && obstacle.elev >= camera.height - .08 && distToObs(camera.x, camera.y, obstacle) < .12);
}

/** Same mounting rules for plan dragging, 3D dragging and inspector edits. */
export function placeEditedCamera(camera: Camera, layout: Layout): Camera | null {
  const normalized = normalizeCameraPlacement(camera, layout);
  if (cameraMount(normalized) === 'ceiling') {
    const placed = { ...normalized, x: round2(clamp(snap(camera.x, layout.gridM), 0, layout.widthM)), y: round2(clamp(snap(camera.y, layout.gridM), 0, layout.heightM)) };
    return canPlaceCeilingCamera(placed, layout) ? placed : null;
  }
  const [x, y] = snapToWall(camera.x, camera.y, layout.widthM, layout.heightM, layout.gridM, layout.floorPolygon);
  return { ...normalized, x, y };
}

export function ceilingInsertionPoint(layout: Layout): [number, number] | null {
  const spacing = Math.max(.5, layout.gridM);
  const points: [number, number][] = [];
  for (let y = spacing; y < layout.heightM; y += spacing) for (let x = spacing; x < layout.widthM; x += spacing) points.push([x, y]);
  points.sort((a, b) => Math.hypot(a[0] - layout.widthM / 2, a[1] - layout.heightM / 2) - Math.hypot(b[0] - layout.widthM / 2, b[1] - layout.heightM / 2));
  return points.find(([x, y]) => {
    const camera = normalizeCameraPlacement({ id: '', x, y, mount: 'ceiling', pan: 0, fov: 85, res: 2560, range: 10, height: 3 }, layout);
    return canPlaceCeilingCamera(camera, layout) && !layout.cameras.some(other => Math.hypot(other.x - x, other.y - y) < .25);
  }) ?? null;
}
