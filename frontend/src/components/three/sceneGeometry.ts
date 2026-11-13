import { Shape, Vector3 } from 'three';
import type { Camera, Layout, Obstacle } from '../../types';
import { floorOutline, pointInFloor, projectToSegment } from '../../core/footprint';
import { obsPoly, type Pt } from '../../core/geometry';
import { cameraProjection } from '../../core/camera';

export function floorShape(layout: Layout) {
  // The editor's (x, y) maps to Three's (x, z), with +Y pointing upward.
  const points = floorOutline(layout);
  const shape = new Shape();
  shape.moveTo(points[0][0], -points[0][1]);
  points.slice(1).forEach(([x, y]) => shape.lineTo(x, -y));
  shape.closePath();
  return shape;
}

export interface WallSegment {
  start: Pt;
  end: Pt;
  outward: Pt;
  opening: boolean;
}

/** Orient the open face of wall shelving and coolers toward the shop interior. */
export function fixtureBodyRotation(obstacle: Obstacle, outline: Pt[]) {
  const aligned = obstacle.h > obstacle.w && obstacle.fixture !== 'partition' && obstacle.fixture !== 'column' ? -Math.PI / 2 : 0;
  if (obstacle.fixture !== 'wall-shelf' && obstacle.fixture !== 'fridge') return aligned;
  const center: Pt = [obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2];
  const nearest = outline.map((a, i) => projectToSegment(center, a, outline[(i + 1) % outline.length])).sort((a, b) => a.distance - b.distance)[0];
  const angle = -obstacle.angle * Math.PI / 180 + aligned;
  const facingInward = Math.sin(angle) * (center[0] - nearest.point[0]) + Math.cos(angle) * (center[1] - nearest.point[1]);
  return aligned + (facingInward < 0 ? Math.PI : 0);
}

/** Split boundary walls at entrance footprints, including sloping polygon edges. */
export function wallSegments(layout: Layout): WallSegment[] {
  const outline = floorOutline(layout);
  const area = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const winding = Math.sign(area);
  const doors = layout.obstacles.filter(o => o.type === 'entrance');
  return outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const openings = doors.flatMap(door => {
      const center: Pt = [door.x + door.w / 2, door.y + door.h / 2];
      const corners = obsPoly(door);
      const depths = corners.map(p => Math.abs((p[0] - center[0]) * dz - (p[1] - center[1]) * dx) / length);
      if (projectToSegment(center, a, b).distance > Math.max(...depths) + 0.22) return [];
      const projected = corners.map(p => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (length * length));
      const from = Math.max(0, Math.min(...projected)), to = Math.min(1, Math.max(...projected));
      return to > from ? [[from, to]] : [];
    });
    const cuts = [...new Set([0, 1, ...openings.flat()])].sort((x, y) => x - y);
    const point = (t: number): Pt => [a[0] + dx * t, a[1] + dz * t];
    return cuts.slice(0, -1).map((from, j) => {
      const to = cuts[j + 1], mid = (from + to) / 2;
      return {
        start: point(from), end: point(to),
        outward: [winding * dz / length, -winding * dx / length] as Pt,
        opening: openings.some(([lo, hi]) => mid >= lo && mid <= hi)
      };
    }).filter(segment => Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) > 0.001);
  });
}

export function cameraPose(camera: Camera, layout: Layout) {
  const { tilt } = cameraProjection(camera);
  const pan = camera.pan * Math.PI / 180, pitch = tilt * Math.PI / 180;
  const direction = new Vector3(Math.cos(pan) * Math.cos(pitch), -Math.sin(pitch), Math.sin(pan) * Math.cos(pitch));
  // A lens sits slightly in front of its wall anchor, inside the room.
  const outline = floorOutline(layout);
  let x = camera.x, z = camera.y;
  const forward: Pt = [x + Math.cos(pan) * 0.16, z + Math.sin(pan) * 0.16];
  if (pointInFloor(forward, outline)) [x, z] = forward;
  else {
    const edges = outline.map((a, i) => ({ a, b: outline[(i + 1) % outline.length] }));
    const edge = edges.sort((a, b) => projectToSegment([x, z], a.a, a.b).distance - projectToSegment([x, z], b.a, b.b).distance)[0];
    const dx = edge.b[0] - edge.a[0], dz = edge.b[1] - edge.a[1], length = Math.hypot(dx, dz);
    for (const sign of [1, -1]) {
      const inset: Pt = [x - sign * dz / length * 0.16, z + sign * dx / length * 0.16];
      if (pointInFloor(inset, outline)) { [x, z] = inset; break; }
    }
  }
  return { position: new Vector3(x, camera.height, z), direction };
}
