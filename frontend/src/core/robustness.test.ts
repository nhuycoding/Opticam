import legacyLayout from '../../../legacy_pygame/opticam_layout_export.json';
import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { normalizeCameras, normalizeLayout, parseBundle, exportBundle } from './io';
import { resizeObstacle, resizeRoom } from './editor';
import { obstacleFitsRoom, wallAnchors } from './geometry';
import { buildCandidates, greedyPlace } from './optimizer';
import { buildZones, evaluate } from './optics';
import { bomToCsv, buildBom } from './bom';

const room = () => ({ ...withManualCams(PRESETS[0]), widthM: 4, heightM: 3, obstacles: [], cameras: [] });

describe('Import validation', () => {
  it.each([0, -1, 0.001, 3])('rejects unsafe grid size %s before allocating the grid', (gridM) => {
    expect(() => normalizeLayout({ ...room(), gridM })).toThrow();
  });
  it('rejects oversized grids and malformed objects', () => {
    expect(() => normalizeLayout({ ...room(), widthM: 40, heightM: 40, gridM: 0.1 })).toThrow(/12.000/);
    expect(() => normalizeLayout({ ...room(), obstacles: [null] })).toThrow();
    expect(() => normalizeLayout({ ...room(), cameras: [null] })).toThrow();
    expect(() => normalizeLayout({ ...room(), background: { dataUrl: 'bad' } })).toThrow();
    expect(() => parseBundle(' '.repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
  });
  it('normalizes camera angles, physical settings and duplicate IDs', () => {
    const cameras = normalizeCameras([{ id: 'c', pan: 1080, fov: 0, range: -1 }, { id: 'c', pan_angle: -45 }], 4, 3);
    expect(cameras.map((camera) => camera.pan)).toEqual([0, 315]);
    expect(cameras[0]).toMatchObject({ fov: 30, range: 1 });
    expect(new Set(cameras.map((camera) => camera.id)).size).toBe(2);
  });
  it('reads UTF-8 BOM files and the supplied legacy Pygame export', () => {
    expect(parseBundle('\uFEFF' + JSON.stringify(room())).widthM).toBe(4);
    expect(normalizeLayout(legacyLayout).widthM).toBe(10);
    for (const mime of ['svg+xml', 'avif']) {
      const background = { dataUrl: `data:image/${mime};base64,AAAA`, widthM: 4, opacity: 0.5, visible: true };
      expect(normalizeLayout({ ...room(), background }).background?.dataUrl).toBe(background.dataUrl);
    }
  });
  it('round-trips all supplied layouts including risk strokes and camera settings', () => {
    for (const preset of PRESETS) {
      const layout = withManualCams(preset);
      const restored = parseBundle(exportBundle(layout, evaluate(layout, buildZones(layout)).score));
      expect(evaluate(restored, buildZones(restored)).score.weighted).toBe(evaluate(layout, buildZones(layout)).score.weighted);
      expect(restored.cameras).toEqual(layout.cameras);
    }
  });
});

describe('Geometry and resource bounds', () => {
  it('keeps every anchor on the boundary for dimensions not divisible by grid size', () => {
    const anchors = wallAnchors(3.8, 3.3, 2);
    expect(anchors.every(([x, y]) => x >= 0 && x <= 3.8 && y >= 0 && y <= 3.3)).toBe(true);
    expect(anchors).toContainEqual([3.8, 3.3]);
  });
  it('rejects shrinking a room around oversized furniture', () => {
    const layout = withManualCams(PRESETS[0]);
    expect(resizeRoom(layout, 3, 3)).toBe(layout);
  });
  it('rejects resizing rotated furniture beyond a wall', () => {
    const base = room();
    const obstacle = { id: 's', type: 'shelf' as const, label: 'Shelf', x: 1, y: 1, w: 1, h: 0.5, angle: 45, elev: 1.8 };
    const layout = { ...base, obstacles: [obstacle] };
    const result = resizeObstacle(layout, 's', 4, 3);
    expect(result).toBe(layout);
    expect(obstacleFitsRoom(result.obstacles[0], 4, 3)).toBe(true);
  });
  it('returns distinct candidates even after the DORI score saturates', () => {
    const layout = room();
    const cameras = greedyPlace(layout, buildZones(layout), 20);
    expect(new Set(cameras.map(({ x, y, pan }) => `${x}/${y}/${pan}`)).size).toBe(cameras.length);
    expect(cameras.at(-1)?.id).toBe('CAM-20');
  });
  it('bounds dense candidate allocation and terminates at the four corner anchors', () => {
    const layout = { ...room(), widthM: 40, heightM: 30, gridM: 0.32 };
    const zones = buildZones(layout);
    const candidates = buildCandidates(layout, zones);
    expect(candidates.length * zones.length).toBeLessThanOrEqual(4 * 24 * zones.length);
  });
  it('optimizes positions when callers supply complete camera objects as profiles', () => {
    const layout = withManualCams(PRESETS[0]);
    const zones = buildZones(layout);
    const fullProfiles = greedyPlace(layout, zones, 3, true, { cameraProfiles: layout.cameras });
    const opticalProfiles = layout.cameras.map(({ fov, res, range, height, model }) => ({ fov, res, range, height, model }));
    expect(fullProfiles).toEqual(greedyPlace(layout, zones, 3, true, { cameraProfiles: opticalProfiles }));
    const candidates = buildCandidates(layout, zones, { cameraProfile: layout.cameras[0] });
    expect(new Set(candidates.map(({ cam }) => `${cam.x}/${cam.y}/${cam.pan}`)).size).toBeGreaterThan(1);
  });
  it('continues to later camera profiles when earlier profiles cannot see a free cell', () => {
    const layout = { ...room(), widthM: 40, heightM: 40 };
    const zones = [{ r: 0, c: 0, cx: 20, cy: 20, w: 5, solid: false }];
    const profiles = [{ fov: 85, res: 2560, range: 1, height: 2.4 }, { fov: 85, res: 2560, range: 30, height: 2.4 }];
    expect(greedyPlace(layout, zones, 2, true, { cameraProfiles: profiles })).toHaveLength(1);
  });
  it('rejects a zero candidate step and handles fully blocked rooms', () => {
    const layout = room();
    expect(() => buildCandidates(layout, [], { anchorStep: 0 })).toThrow();
    expect(greedyPlace(layout, buildZones(layout).map((zone) => ({ ...zone, solid: true })), 3)).toEqual([]);
  });
});

describe('BOM exports', () => {
  it('uses each camera height and agrees on an empty project total', () => {
    const layout = withManualCams(PRESETS[0]);
    const base = buildBom(layout).totalCableM;
    const taller = buildBom({ ...layout, cameras: layout.cameras.map((camera) => ({ ...camera, height: 4 })) });
    expect(taller.totalCableM).toBeGreaterThan(base);
    expect(buildBom(room()).totalCostVnd).toBe(0);
  });
  it('escapes embedded quotes and neutralizes spreadsheet formulas in CSV', () => {
    const layout = withManualCams(PRESETS[0]);
    layout.cameras[0] = { ...layout.cameras[0], model: '=SUM(1,2)', target: 'A "quoted" model' };
    const csv = bomToCsv(layout);
    expect(csv).toContain('"A ""quoted"" model"');
    expect(csv).toContain('"\'=SUM(1,2)"');
  });
});
