import { describe, expect, it } from 'vitest';
import type { Camera } from '../types';
import { cameraFootprint } from './cameraFootprint';
import { pointInFloor } from './footprint';
import { ppmAt } from './optics';

const camera: Camera = { id: 'ceiling', x: 4, y: 3, height: 3.05, mount: 'ceiling', pan: 0,
  tilt: 90, fov: 90, vfov: 60, res: 1920, range: 10 };

describe('Perspective footprint on the target plane', () => {
  it('draws a rectangle around a downward lens and rotates its sensor aspect with pan', () => {
    const footprint = cameraFootprint(camera);
    expect(footprint).toHaveLength(4);
    expect(pointInFloor([4, 3], footprint)).toBe(true);
    expect(pointInFloor([5, 3], footprint)).toBe(false);
    expect(pointInFloor([4, 4], footprint)).toBe(true);
    const turned = cameraFootprint({ ...camera, pan: 90 });
    expect(pointInFloor([5, 3], turned)).toBe(true);
    expect(pointInFloor([4, 4], turned)).toBe(false);
  });
  it('starts away from the camera when a tilted view misses the area directly underneath', () => {
    const footprint = cameraFootprint({ ...camera, tilt: 45, vfov: 30 });
    expect(pointInFloor([4, 3], footprint)).toBe(false);
    expect(pointInFloor([5.5, 3], footprint)).toBe(true);
    expect(pointInFloor([7, 3], footprint)).toBe(false);
  });
  it('has no footprint when the target plane lies outside the range or behind the lens', () => {
    expect(cameraFootprint({ ...camera, range: 1 })).toEqual([]);
    expect(cameraFootprint(camera, 4)).toEqual([]);
  });
  it('stops at the first wall across a concave room instead of reappearing beyond an exterior notch', () => {
    const polygon: [number, number][] = [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]];
    const view = { ...camera, x: 1, y: 5, pan: 315, tilt: 20, fov: 120, vfov: 90 };
    const footprint = cameraFootprint(view, 1.6, polygon);
    expect(pointInFloor([2, 4], footprint)).toBe(true);
    expect(pointInFloor([7, 1], footprint)).toBe(false);
    expect(ppmAt(view, 7, 1, [], 1.6, polygon)).toBe(0);
  });
  it('matches 3D optical visibility for sampled wall and ceiling views', () => {
    let checked = 0;
    for (const tilt of [0, 20, 55, 90]) for (const pan of [0, 37, 195]) {
      const view = { ...camera, tilt, pan, fov: 85, vfov: 62, range: 6 };
      const footprint = cameraFootprint(view);
      for (let x = -2.21; x < 10; x += .47) for (let y = -3.13; y < 9; y += .43) {
        // The finite circle tessellation is inscribed, so exclude its narrow range boundary.
        if (Math.abs(Math.hypot(x - view.x, y - view.y, 1.6 - view.height) - view.range) < .02) continue;
        expect(footprint.length > 2 && pointInFloor([x, y], footprint)).toBe(ppmAt(view, x, y, []) > 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});
