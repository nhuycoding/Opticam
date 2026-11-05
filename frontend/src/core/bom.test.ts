import { describe, expect, it } from 'vitest';
import { PRESETS } from '../data/presets';
import { bomToCsv, buildBom } from './bom';

const camera = {
  id: 'CAM-01', x: 0, y: 0, pan: 0, fov: 85, res: 2560, range: 10, height: 3,
};

const layout = {
  ...PRESETS[0],
  obstacles: [{
    id: 'pos', type: 'pos' as const, label: 'POS', x: 1, y: 1, w: 2, h: 1, elev: 1.1, angle: 0,
  }],
  cameras: [
    { ...camera, powerW: 14.5 },
    { ...camera, id: 'CAM-02', x: 4, y: 1.5, height: 2.4 },
  ],
};

describe('BOM cable and PoE estimates', () => {
  it('uses the POS center, per-camera height, rated watts, and 20% PoE reserve', () => {
    const bom = buildBom(layout);
    expect(bom.rows.map(({ cableM, powerW }) => ({ cableM, powerW }))).toEqual([
      { cableM: 11, powerW: 14.5 },
      { cableM: 9, powerW: 12 },
    ]);
    expect(bom.totalCableM).toBe(20);
    expect(bom.totalCameraPowerW).toBe(26.5);
    expect(bom.recommendedPoeBudgetW).toBe(32);
    expect(bom.poePorts).toBe(2);
    expect(bom.totalCostVnd).toBe(4_000_000);
  });

  it('does not include infrastructure costs or power budget when there are no cameras', () => {
    const bom = buildBom({ ...layout, cameras: [] });
    expect(bom.totalCameraPowerW).toBe(0);
    expect(bom.recommendedPoeBudgetW).toBe(0);
    expect(bom.totalCostVnd).toBe(0);
  });

  it('rejects invalid explicit power values instead of silently estimating', () => {
    expect(() => buildBom({
      ...layout,
      cameras: [{ ...camera, powerW: Number.NaN }],
    })).toThrow(RangeError);
  });

  it('exports per-camera power and PoE sizing in CSV', () => {
    const csv = bomToCsv(layout);
    expect(csv).toContain('Cong suat (W)');
    expect(csv).toContain('"CAM-01"');
    expect(csv).toContain('"14.5"');
    expect(csv).toContain('"32"');
    expect(csv).toContain('"20%"');
  });
});
