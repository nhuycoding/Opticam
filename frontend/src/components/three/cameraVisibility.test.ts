import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PRESETS } from '../../data/presets';
import { cameraProjection } from '../../core/camera';
import { cameraBasis, cameraPose } from './sceneGeometry';
import { cameraImageSettings, observationCamera, visibilityAtlasSize } from './cameraVisibility';

const CAMERA = { id: 'CAM-01', x: 0, y: 0, pan: 45, height: 2.4, fov: 85, res: 2560, range: 12 };

describe('3D observation camera projection', () => {
  it('uses the actual lens, tilt and both fields of view from the POV model', () => {
    const layout = PRESETS[0];
    const camera = { ...CAMERA, pan: 135, tilt: 37, fov: 90, vfov: 60, range: 8 };
    const lens = observationCamera(camera, layout), pose = cameraPose(camera, layout);
    expect(lens.position.distanceTo(pose.position)).toBeLessThan(1e-9);
    expect(lens.getWorldDirection(new Vector3()).distanceTo(pose.direction)).toBeLessThan(1e-9);
    expect(lens.fov).toBe(60);
    expect(lens.aspect).toBeCloseTo(cameraProjection(camera).aspect);
    const centre = pose.position.clone().addScaledVector(pose.direction, 3).project(lens);
    expect(centre.x).toBeCloseTo(0); expect(centre.y).toBeCloseTo(0);
    const right = new Vector3().crossVectors(pose.direction, new Vector3(0, 1, 0)).normalize();
    const outsideHorizontalFov = pose.position.clone().addScaledVector(pose.direction, 3).addScaledVector(right, 3.1).project(lens);
    expect(outsideHorizontalFov.x).toBeGreaterThan(1);
    const beyondRange = pose.position.clone().addScaledVector(pose.direction, 9).project(lens);
    expect(beyondRange.z).toBeGreaterThan(1);
  });

  it('preserves ceiling camera pan even when pointing vertically down', () => {
    for (const pan of [0, 45, 90, 180, 270]) {
      const camera = { ...CAMERA, x: 4, y: 3, height: 3.05, mount: 'ceiling' as const, tilt: 90, pan };
      const lens = observationCamera(camera, PRESETS[0]), basis = cameraBasis(camera);
      const centre = lens.position.clone().addScaledVector(basis.direction, 2);
      const right = centre.clone().addScaledVector(basis.right, 0.5).project(lens);
      const up = centre.clone().addScaledVector(basis.up, 0.5).project(lens);
      expect(right.x).toBeGreaterThan(0); expect(right.y).toBeCloseTo(0);
      expect(up.y).toBeGreaterThan(0); expect(up.x).toBeCloseTo(0);
      expect(lens.getWorldDirection(new Vector3()).distanceTo(basis.direction)).toBeLessThan(1e-9);
    }
  });

  it('uses the analysis PPM formula and preserves resolution, FOV and range semantics', () => {
    const regular = cameraImageSettings({ ...CAMERA, range: 12, res: 1920, fov: 90 });
    expect(regular.ppmScale / 10).toBeCloseTo(96);
    expect(regular.ppmScale / 10 * 0.16).toBeCloseTo(15.36);
    expect(cameraImageSettings({ ...CAMERA, res: 3840 }).ppmScale).toBeCloseTo(2 * cameraImageSettings({ ...CAMERA, res: 1920 }).ppmScale);
    expect(cameraImageSettings({ ...CAMERA, fov: 60 }).ppmScale).toBeGreaterThan(cameraImageSettings({ ...CAMERA, fov: 90 }).ppmScale);
    expect(cameraImageSettings({ ...CAMERA, range: 30 }).ppmScale).toBe(cameraImageSettings({ ...CAMERA, range: 10 }).ppmScale);
  });

  it('fits every supported camera into a bounded atlas and respects hardware texture limits', () => {
    for (let count = 0; count <= 20; count++) {
      const atlas = visibilityAtlasSize(count, 2048);
      expect(atlas.columns * atlas.rows).toBeGreaterThanOrEqual(count);
      expect(Math.max(atlas.width, atlas.height)).toBeLessThanOrEqual(2048);
      expect(atlas.width * atlas.height).toBeLessThanOrEqual(512 * 512 * 8);
    }
    expect(visibilityAtlasSize(20, 1024).width).toBeLessThanOrEqual(1024);
    expect(visibilityAtlasSize(0, 2048).width).toBe(1);
  });
});
