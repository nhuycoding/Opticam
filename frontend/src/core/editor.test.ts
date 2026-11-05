import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { addObstacle, removeObstacle, resizeObstacle, resizeRoom } from './editor';
import { fromApiResponse, toApiPayload } from './api';
import { obsPoly, satCollide } from './geometry';
import { buildZones } from './optics';
import { cameraQualityForResolution, CAMERA_QUALITY_PRESETS } from './camera';
import { normalizeLayout } from './io';

const noOverlap = (l: ReturnType<typeof withManualCams>) =>
  l.obstacles.every((a, i) => l.obstacles.every((b, j) => i >= j || !satCollide(obsPoly(a), obsPoly(b))));

describe('Editor', () => {
  it('thêm kệ/POS/cửa không chồng lấn; xoá được', () => {
    let l = withManualCams(PRESETS[2]);
    for (const t of ['shelf', 'pos', 'entrance', 'shelf'] as const) { const r = addObstacle(l, t); expect(r).not.toBeNull(); l = r!; }
    expect(noOverlap(l)).toBe(true);
    const last = l.obstacles[l.obstacles.length - 1];
    expect(removeObstacle(l, last.id).obstacles).toHaveLength(l.obstacles.length - 1);
  });
  it('đổi kích thước bị từ chối nếu chồng lấn', () => {
    const l = withManualCams(PRESETS[0]), id = l.obstacles.find((o) => o.type === 'shelf')!.id;
    expect(noOverlap(resizeObstacle(l, id, 4.5, 4))).toBe(true);
  });
  it('đổi tường bao: vật cản nằm trong phòng, camera bám tường, cửa còn sát tường', () => {
    const r = resizeRoom(withManualCams(PRESETS[0]), 9, 5.5);
    expect(r.widthM).toBe(9); expect(r.heightM).toBe(5.5);
    expect(r.cameras.every((c) => c.x === 0 || c.x === 9 || c.y === 0 || c.y === 5.5)).toBe(true);
    expect(r.obstacles.every((o) => o.x >= -1e-9 && o.y >= -1e-9)).toBe(true);
  });
});
describe('API adapter', () => {
  it('payload có ma trận rủi ro đúng kích thước', () => {
    const l = withManualCams(PRESETS[0]), p = toApiPayload(l, buildZones(l), 3);
    expect(p.riskMatrix).toHaveLength(12); expect(p.riskMatrix[0]).toHaveLength(20);
    expect(p.riskMatrix.flat().every((w) => [1, 3, 5].includes(w))).toBe(true);
  });
  it('response chấp nhận pan_angle và data.cameras', () => {
    const l = withManualCams(PRESETS[0]);
    expect(fromApiResponse({ data: { cameras: [{ x: 0, y: 3, pan_angle: 45 }] } }, l)[0].pan).toBe(45);
    expect(() => fromApiResponse({ cameras: [] }, l)).toThrow();
  });
});
describe('Camera quality settings', () => {
  it('maps 2MP, 4MP and 8MP profiles to the sensor resolutions used by PPM', () => {
    expect(CAMERA_QUALITY_PRESETS.map((profile) => profile.resolution)).toEqual([1920, 2560, 3840]);
    expect(cameraQualityForResolution(2560)).toBe('4mp');
    expect(cameraQualityForResolution(2048)).toBe('custom');
  });
  it('preserves rated PoE power from imported layouts and rejects invalid values', () => {
    const raw = {
      name: 'Power test', widthM: 4, heightM: 3, obstacles: [],
      cameras: [{ id: 'CAM-01', x: 0, y: 0, powerW: 18.5 }],
    };
    expect(normalizeLayout(raw).cameras[0].powerW).toBe(18.5);
    expect(() => normalizeLayout({
      ...raw,
      cameras: [{ ...raw.cameras[0], powerW: 0 }],
    })).toThrow(/powerW|Công suất/i);
  });
});
