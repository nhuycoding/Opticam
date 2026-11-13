import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, ShapeGeometry, Vector3 } from 'three';
import { PRESETS } from '../../data/presets';
import { cameraProjection } from '../../core/camera';
import { floorArea, floorOutline, pointInFloor, projectToSegment } from '../../core/footprint';
import { makeCamera, greedyPlace } from '../../core/optimizer';
import { buildZones, evaluate } from '../../core/optics';
import { exportBundle, parseBundle } from '../../core/io';
import { toApiPayload, fromApiResponse } from '../../core/api';
import { cameraPose, fixtureBodyRotation, floorShape, wallSegments } from './sceneGeometry';

describe('shared floor plan and 3D projection', () => {
  it.each(PRESETS)('triangulates $name without filling its exterior', layout => {
    const geometry = new ShapeGeometry(floorShape(layout));
    const position = geometry.getAttribute('position'), index = geometry.getIndex()!;
    let area = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(position, index.getX(i));
      const b = new Vector3().fromBufferAttribute(position, index.getX(i + 1));
      const c = new Vector3().fromBufferAttribute(position, index.getX(i + 2));
      area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      expect(pointInFloor([(a.x + b.x + c.x) / 3, -(a.y + b.y + c.y) / 3], floorOutline(layout))).toBe(true);
    }
    expect(area).toBeCloseTo(floorArea(layout), 4);
    geometry.dispose();
  });

  it.each(PRESETS)('places wall-mounted lenses inside $name', layout => {
    for (const camera of layout.cameras) {
      const pose = cameraPose(camera, layout);
      expect(pointInFloor([pose.position.x, pose.position.z], floorOutline(layout))).toBe(true);
      expect(pose.position.y).toBe(camera.height);
      expect(pose.direction.length()).toBeCloseTo(1);
    }
  });

  it('matches the perspective camera to horizontal and vertical FOV', () => {
    const layout = PRESETS[0];
    const camera = { ...makeCamera('TEST', 0, 3, 0), fov: 90, tilt: 30, vfov: 60 };
    const projection = cameraProjection(camera), pose = cameraPose(camera, layout);
    expect(pose.direction.y).toBeCloseTo(-0.5);
    const lens = new PerspectiveCamera(projection.vfov, projection.aspect, 0.03, 100);
    lens.position.copy(pose.position); lens.lookAt(pose.position.clone().add(pose.direction)); lens.updateMatrixWorld();
    const right = new Vector3().crossVectors(pose.direction, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, pose.direction).normalize();
    const center = pose.position.clone().addScaledVector(pose.direction, 5);
    expect(center.clone().project(lens).x).toBeCloseTo(0);
    expect(center.clone().project(lens).y).toBeCloseTo(0);
    expect(center.clone().addScaledVector(right, 5).project(lens).x).toBeCloseTo(1);
    expect(center.clone().addScaledVector(up, Math.tan(Math.PI / 6) * 5).project(lens).y).toBeCloseTo(1);
    expect(cameraProjection(makeCamera('OLD', 0, 0, 45)).aspect).toBeCloseTo(16 / 9);
  });

  it('faces wall shelves and coolers into the interior, including sloping walls', () => {
    for (const layout of PRESETS.slice(3)) {
      const outline = floorOutline(layout);
      for (const obstacle of layout.obstacles.filter(o => o.fixture === 'wall-shelf' || o.fixture === 'fridge')) {
        const center: [number, number] = [obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2];
        const nearest = outline.map((a, i) => projectToSegment(center, a, outline[(i + 1) % outline.length])).sort((a, b) => a.distance - b.distance)[0];
        const rotation = -obstacle.angle * Math.PI / 180 + fixtureBodyRotation(obstacle, outline);
        expect(Math.sin(rotation) * (center[0] - nearest.point[0]) + Math.cos(rotation) * (center[1] - nearest.point[1])).toBeGreaterThan(0);
      }
    }
  });

  it('opens walls at entrances and handles either polygon winding', () => {
    const layout = { ...PRESETS[0], obstacles: [{ id: 'door', type: 'entrance' as const, label: 'Cửa', x: 1, y: 0, w: 2, h: 0.2, angle: 0, elev: 2.4 }] };
    const opening = wallSegments(layout).find(segment => segment.opening)!;
    expect(opening.start).toEqual([1, 0]); expect(opening.end).toEqual([3, 0]);
    for (const outline of [floorOutline(layout), floorOutline(layout).reverse()]) {
      for (const wall of wallSegments({ ...layout, floorPolygon: outline })) {
        const cx = (wall.start[0] + wall.end[0]) / 2, cy = (wall.start[1] + wall.end[1]) / 2;
        expect(pointInFloor([cx - wall.outward[0] * 0.01, cy - wall.outward[1] * 0.01], outline)).toBe(true);
      }
    }
  });

  it('keeps 3D lens settings through files, API payloads, and the local solver', () => {
    const camera = { ...makeCamera('C', 0, 0, 45), tilt: 35, vfov: 62 };
    const layout = { ...PRESETS[0], cameras: [camera] }, zones = buildZones(layout);
    expect(parseBundle(exportBundle(layout, evaluate(layout, zones).score)).cameras[0]).toMatchObject({ tilt: 35, vfov: 62 });
    expect(toApiPayload(layout, zones, 1, [camera]).cameraProfiles?.[0]).toMatchObject({ tilt: 35, vfov: 62 });
    expect(fromApiResponse({ cameras: [camera] }, layout)[0]).toMatchObject({ tilt: 35, vfov: 62 });
    expect(greedyPlace(layout, zones, 1, true, { cameraProfiles: [camera] })[0]).toMatchObject({ tilt: 35, vfov: 62 });
    expect(cameraProjection(makeCamera('OLD', 0, 0, 45)).tilt).toBe(20);
  });
});
