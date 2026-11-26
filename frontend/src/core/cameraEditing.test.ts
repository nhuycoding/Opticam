import { describe, expect, it } from 'vitest';
import { PRESETS } from '../data/presets';
import { canPlaceCeilingCamera, placeEditedCamera } from './cameraEditing';
import { resizeRoom } from './editor';
import type { Camera, Layout } from '../types';

const camera: Camera = { id: 'CEIL', mount: 'ceiling', x: 3, y: 3, height: 3.05, ceilingDrop: .15, tilt: 90, pan: 0, fov: 85, range: 10, res: 2560 };
const layout = (): Layout => ({ ...structuredClone(PRESETS[0]), ceilingHeight: 3.2, obstacles: [], cameras: [camera] });
describe('shared ceiling camera editing', () => {
  it('moves inside the room without snapping to the wall and keeps mounting height', () => {
    const placed = placeEditedCamera({ ...camera, x: 4.1, y: 2.4, height: 1.9 }, layout());
    expect(placed).toMatchObject({ x: 4, y: 2.5, mount: 'ceiling' });
    expect(placed!.height).toBeCloseTo(3.05);
  });
  it('rejects polygon cutouts, wall clearance and columns crossing the lens', () => {
    const l = layout(); l.floorPolygon = [[0,0], [10,0], [10,3], [4,3], [4,6], [0,6]];
    expect(canPlaceCeilingCamera({ ...camera, x: 8, y: 5 }, l)).toBe(false);
    expect(canPlaceCeilingCamera({ ...camera, x: .05 }, l)).toBe(false);
    l.obstacles = [{ id: 'column', type: 'shelf', x: 2.8, y: 2.8, w: .4, h: .4, elev: 3.2, angle: 0, label: 'Cột' }];
    expect(canPlaceCeilingCamera(camera, l)).toBe(false);
    l.obstacles[0].elev = 1.8;
    expect(canPlaceCeilingCamera(camera, l)).toBe(true);
  });
  it('preserves interior ceiling mounting when resizing a store', () => {
    const resized = resizeRoom(layout(), 12, 8);
    expect(resized.cameras[0]).toMatchObject({ mount: 'ceiling', x: 3.5, y: 4 });
    expect(resized.cameras[0].height).toBeCloseTo(3.05);
  });
});
