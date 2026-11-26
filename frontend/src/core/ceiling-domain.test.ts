import { describe, expect, it } from 'vitest';
import type { Camera, Layout } from '../types';
import { cameraProjection, ceilingCameraHeight, ceilingHeightFor, normalizeCameraPlacement } from './camera';
import { exportBundle, normalizeLayout, parseBundle } from './io';
import { buildZones, evaluate, ppmAt } from './optics';

const room: Layout = { version: '1', name: 'Ceiling', widthM: 8, heightM: 6, gridM: 0.5, pixelsPerMeter: 68,
  targetHeight: 1.6, ceilingHeight: 3.2, obstacles: [], risk: {}, riskStrokes: [], cameras: [] };
const camera: Camera = { id: 'CAM-01', x: 4, y: 3, pan: 0, tilt: 90, mount: 'ceiling',
  fov: 90, vfov: 60, res: 1920, range: 10, height: 3.05, ceilingDrop: 0.15 };

describe('Ceiling mounting and project persistence', () => {
  it('keeps lens below the ceiling when changing room height or importing inconsistent elevations', () => {
    expect(normalizeCameraPlacement({ ...camera, height: 2 }, { ceilingHeight: 4 }).height).toBeCloseTo(3.85);
    expect(ceilingCameraHeight({ ceilingHeight: 2.4 }, 5)).toBeCloseTo(1.8);
    expect(ceilingCameraHeight(room, -1)).toBeCloseTo(3.05);
    expect(normalizeCameraPlacement({ ...camera, mount: 'wall', height: 5 }, room).height).toBe(2.9);
    expect(ceilingHeightFor({})).toBe(3.2);
  });
  it('round-trips mixed installations with ceiling height, drop, vertical view and solver settings', () => {
    const layout: Layout = { ...room, ceilingHeight: 4,
      optimization: { algorithm: 'hybrid', mounts: 'mixed' },
      cameras: [{ ...camera, height: 3.85 }, { ...camera, id: 'CAM-02', x: 0, mount: 'wall', height: 2.4, tilt: 20, ceilingDrop: undefined }] };
    const restored = parseBundle(exportBundle(layout, evaluate(layout, buildZones(layout)).score));
    expect(restored.ceilingHeight).toBe(4);
    expect(restored.optimization).toEqual(layout.optimization);
    expect(restored.cameras[0]).toEqual(layout.cameras[0]);
    expect(restored.cameras[1].mount).toBe('wall');
    expect(restored.cameras[1].height).toBe(2.4);
  });
  it('imports old projects with wall defaults and rejects ceiling lenses embedded in tall furniture', () => {
    const legacy = normalizeLayout({ ...room, ceilingHeight: undefined, cameras: [{ ...camera, mount: undefined, tilt: undefined }] });
    expect(cameraProjection(legacy.cameras[0]).tilt).toBe(20);
    expect(legacy.optimization).toEqual({ algorithm: 'kpi_hybrid', mounts: 'mixed' });
    const obstacle = { id: 'tall', type: 'shelf', x: 3.5, y: 2.5, w: 1, h: 1, angle: 0, elev: 3.1 };
    expect(() => normalizeLayout({ ...room, obstacles: [obstacle], cameras: [camera] })).toThrow(/vật cản cao/);
    expect(() => normalizeLayout({ ...room, cameras: [{ ...camera, x: 0.05 }] })).toThrow(/cách tường/);
  });
});

describe('Camera-frame 3D visibility', () => {
  it('supports a vertical camera and clips independently along horizontal and vertical sensor axes', () => {
    expect(ppmAt(camera, 4, 3, [])).toBeGreaterThan(0);
    expect(ppmAt(camera, 5, 3, [])).toBe(0); // 1m along vertical sensor axis exceeds 60° at 1.45m height difference.
    expect(ppmAt(camera, 4, 4, [])).toBeGreaterThan(0); // Same distance along the wider 90° sensor axis.
    expect(ppmAt({ ...camera, pan: 90 }, 5, 3, [])).toBeGreaterThan(0);
    expect(ppmAt({ ...camera, pan: 90 }, 4, 4, [])).toBe(0);
  });
  it('rejects targets beyond vertical FOV even when they lie inside the flat horizontal fan', () => {
    const level = { ...camera, x: 0, height: 3.05, tilt: 0, vfov: 20 };
    expect(ppmAt(level, 2, 3, [])).toBe(0);
    expect(ppmAt({ ...level, tilt: 36 }, 2, 3, [])).toBeGreaterThan(0);
  });
  it('uses slant range and blocks downward sightlines through shelf tops', () => {
    expect(ppmAt({ ...camera, range: 1.4 }, 4, 3, [])).toBe(0);
    const shelf = { id: 's', type: 'shelf' as const, label: 'Shelf', x: 3.5, y: 2.5, w: 1, h: 1, angle: 0, elev: 1.8 };
    expect(ppmAt(camera, 4, 3, [shelf])).toBe(0);
    expect(ppmAt(camera, 4, 3, [{ ...shelf, elev: 1.2 }])).toBeGreaterThan(0);
  });
});
