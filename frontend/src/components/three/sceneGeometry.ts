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

export const CAMERA_BODY_CLEARANCE = 0.34;
export const CAMERA_LENS_OFFSET = 0.216;

/** The body stays clear of every wall while its lens can swivel independently. */
export function cameraAssemblyPose(camera: Camera, layout: Layout) {
  const { tilt } = cameraProjection(camera);
  const pan = camera.pan * Math.PI / 180, pitch = tilt * Math.PI / 180;
  const direction = new Vector3(Math.cos(pan) * Math.cos(pitch), -Math.sin(pitch), Math.sin(pan) * Math.cos(pitch));
  const outline = floorOutline(layout);
  const area = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, inward: [-Math.sign(area) * (b[1] - a[1]) / length, Math.sign(area) * (b[0] - a[0]) / length] as Pt };
  });
  const clearanceAt = (point: Pt) => Math.min(...edges.map(edge => projectToSegment(point, edge.a, edge.b).distance));
  let body: Pt = [camera.x, camera.y];
  for (let pass = 0; pass < 8; pass++) {
    for (const edge of edges) {
      const projection = projectToSegment(body, edge.a, edge.b);
      if (projection.distance >= CAMERA_BODY_CLEARANCE) continue;
      const normal = projection.distance > 1e-8
        ? [(body[0] - projection.point[0]) / projection.distance, (body[1] - projection.point[1]) / projection.distance]
        : edge.inward;
      const shift = CAMERA_BODY_CLEARANCE - projection.distance + 0.0001;
      body = [body[0] + normal[0] * shift, body[1] + normal[1] * shift];
    }
    if (pointInFloor(body, outline) && clearanceAt(body) >= CAMERA_BODY_CLEARANCE - 1e-6) break;
  }
  // Reflex corners can place an iterative projection outside the floor. Search
  // locally for the closest position with room for the complete rotating body.
  if (!pointInFloor(body, outline) || clearanceAt(body) < CAMERA_BODY_CLEARANCE - 1e-6) {
    const candidates: Pt[] = [];
    for (const radius of [0.49, 0.68, 1.02, 1.36, 2.04]) {
      for (let index = 0; index < 32; index++) {
        const angle = index * Math.PI / 16;
        const point: Pt = [camera.x + Math.cos(angle) * radius, camera.y + Math.sin(angle) * radius];
        if (pointInFloor(point, outline) && clearanceAt(point) >= CAMERA_BODY_CLEARANCE) candidates.push(point);
      }
      if (candidates.length) break;
    }
    if (!candidates.length) {
      const step = Math.max(0.2, Math.min(layout.widthM, layout.heightM) / 20);
      for (let x = CAMERA_BODY_CLEARANCE; x <= layout.widthM - CAMERA_BODY_CLEARANCE; x += step) {
        for (let y = CAMERA_BODY_CLEARANCE; y <= layout.heightM - CAMERA_BODY_CLEARANCE; y += step) {
          const point: Pt = [x, y];
          if (pointInFloor(point, outline) && clearanceAt(point) >= CAMERA_BODY_CLEARANCE) candidates.push(point);
        }
      }
    }
    body = candidates.length
      ? candidates.sort((a, b) => Math.hypot(a[0] - camera.x, a[1] - camera.y) - Math.hypot(b[0] - camera.x, b[1] - camera.y))[0]
      : [camera.x, camera.y];
  }
  const bodyPosition = new Vector3(body[0], camera.height - direction.y * CAMERA_LENS_OFFSET, body[1]);
  const position = bodyPosition.clone().addScaledVector(direction, CAMERA_LENS_OFFSET);
  position.y = camera.height;
  const mountProjection = edges.map(edge => projectToSegment(body, edge.a, edge.b)).sort((a, b) => a.distance - b.distance)[0];
  const wallMounted = mountProjection.distance <= 0.8;
  const mountDirection = wallMounted
    ? new Vector3(body[0] - mountProjection.point[0], 0, body[1] - mountProjection.point[1]).normalize()
    : new Vector3(0, 1, 0);
  // Imported layouts may place cameras in the interior. Use a compact ceiling
  // bracket there, preserving the optical pose without a long arm across aisles.
  const mountPosition = wallMounted
    ? new Vector3(mountProjection.point[0], bodyPosition.y + 0.06, mountProjection.point[1]).addScaledVector(mountDirection, 0.075)
    : bodyPosition.clone().add(new Vector3(0, 0.26, 0));
  return { bodyPosition, position, direction, mountDirection, mountPosition };
}

export function cameraPose(camera: Camera, layout: Layout) {
  const { position, direction } = cameraAssemblyPose(camera, layout);
  return { position, direction };
}
