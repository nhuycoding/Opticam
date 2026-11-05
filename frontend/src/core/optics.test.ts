import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { snapAngle, snapToWall, rectPoly } from './geometry';
import { buildZones, evaluate, ppmAt } from './optics';
import { bruteForce, greedyPlace } from './optimizer';

const cam = { id: 'c', x: 0, y: 3, pan: 0, fov: 90, res: 1920, range: 20, height: 1.6 };

describe('PPM / DORI', () => {
  it('PPM = Res / (2 r tan(FOV/2))', () => expect(ppmAt(cam, 5, 3, [])).toBeCloseTo(192, 1));
  it('ngoài FOV → 0', () => expect(ppmAt(cam, 0, 9, [])).toBe(0));
  it('kệ 1.8m chắn tia nhìn', () => expect(ppmAt(cam, 5, 3, [rectPoly(2.5, 3, 1, 2, 0)])).toBe(0));
});
describe('Hình học', () => {
  it('góc bước 15°', () => { expect(snapAngle(22)).toBe(15); expect(snapAngle(23)).toBe(30); expect(snapAngle(-10)).toBe(345); });
  it('snap-to-wall', () => expect(snapToWall(0.4, 3.1, 10, 6, 0.5)).toEqual([0, 3]));
});
describe('Solver', () => {
  it('Greedy 3 cam < 2s, không kém 4 góc tường về điểm rủi ro', () => {
    const l = withManualCams(PRESETS[0]), z = buildZones(l);
    const t = performance.now(), cams = greedyPlace(l, z, 3);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(cams).toHaveLength(3);
    expect(evaluate({ ...l, cameras: cams }, z).score.weighted).toBeGreaterThanOrEqual(evaluate(l, z).score.weighted);
  });
  it('Vét cạn ≥ Greedy trên cùng tập ứng viên, và Greedy ≥ (1 − 1/e) · Optimum', () => {
    const l = withManualCams(PRESETS[2]), z = buildZones(l), o = { anchorStep: 1, angleStep: 30 };
    const g = evaluate({ ...l, cameras: greedyPlace(l, z, 2, true, o) }, z).score.weighted;
    const b = evaluate({ ...l, cameras: bruteForce(l, z, 2, o).cameras }, z).score.weighted;
    expect(b).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(0.632 * b);
  });
  it('Hàm mục tiêu đơn điệu: thêm camera không làm giảm điểm', () => {
    const l = withManualCams(PRESETS[0]), z = buildZones(l);
    const s = (n: number) => evaluate({ ...l, cameras: l.cameras.slice(0, n) }, z).score.weighted;
    for (let n = 1; n < 4; n++) expect(s(n + 1)).toBeGreaterThanOrEqual(s(n));
  });
});
