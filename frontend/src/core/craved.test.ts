import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../types';
import {
  analyzeObstacleCraved,
  applyTiersToObstacle,
  defaultTiersForObstacle,
  rescaleTiersToElevation,
} from './craved';
import { normalizeLayout } from './io';

const baseShelf: Obstacle = {
  id: 'shelf_1',
  type: 'shelf',
  fixture: 'gondola',
  label: 'Kệ hai mặt',
  x: 2,
  y: 2,
  w: 2.4,
  h: 0.8,
  elev: 1.5,
  angle: 0,
};

describe('Tiered CRAVED merchandising model', () => {
  it('builds physical tiers scaled to fixture height and preserves goods on height edits', () => {
    const gondolaTiers = defaultTiersForObstacle(baseShelf);
    expect(gondolaTiers).toHaveLength(4);
    expect(gondolaTiers[0].zMin).toBeLessThan(1.0);
    expect(gondolaTiers[gondolaTiers.length - 1].zMax).toBeCloseTo(1.5, 2);

    const freezerTiers = defaultTiersForObstacle({ type: 'shelf', fixture: 'freezer', elev: 0.9 });
    expect(freezerTiers).toHaveLength(2);

    const rescaled = rescaleTiersToElevation(gondolaTiers, 2.0);
    expect(rescaled).toHaveLength(4);
    expect(rescaled[rescaled.length - 1].zMax).toBeCloseTo(2.0, 2);
    expect(rescaled[1].goodsIds).toEqual(gondolaTiers[1].goodsIds);
  });

  it('derives CRAVED classification, Wmax, 6-axis vector, and <=1.0m hand alerts from tier goods', () => {
    const tiers = defaultTiersForObstacle(baseShelf).map((tier, idx) =>
      idx === 1 ? { ...tier, goodsIds: ['cosmetics'] } : { ...tier, goodsIds: ['water-pack'] }
    );
    const analysis = analyzeObstacleCraved({ ...baseShelf, tiers });
    expect(analysis.handAlertCount).toBe(1);
    expect(analysis.category).toBe('high');
    expect(analysis.wmax).toBeGreaterThanOrEqual(4);
    expect(analysis.craved.v).toBe(5);

    const bulkyTiers = defaultTiersForObstacle(baseShelf).map((tier) => ({ ...tier, goodsIds: ['rice-grain'] }));
    const bulkyAnalysis = analyzeObstacleCraved({ ...baseShelf, tiers: bulkyTiers });
    expect(bulkyAnalysis.category).toBe('bulky');
    expect(bulkyAnalysis.wmax).toBeLessThan(2.2);
    expect(bulkyAnalysis.handAlertCount).toBe(0);
  });

  it('round-trips new fixture types and shelf tiers cleanly through normalizeLayout', () => {
    const tiers = defaultTiersForObstacle({ type: 'shelf', fixture: 'locked-cabinet', elev: 2.0 });
    const patch = applyTiersToObstacle({ ...baseShelf, fixture: 'locked-cabinet', elev: 2.0 }, tiers);
    const normalized = normalizeLayout({
      widthM: 10,
      heightM: 6,
      gridM: 0.5,
      cameras: [],
      obstacles: [{ ...baseShelf, fixture: 'locked-cabinet', elev: 2.0, ...patch }],
    });
    expect(normalized.obstacles[0].fixture).toBe('locked-cabinet');
    expect(normalized.obstacles[0].tiers).toHaveLength(tiers.length);
    expect(normalized.obstacles[0].riskCategory).toBe('high');
    expect(normalized.obstacles[0].riskWmax).toBeGreaterThanOrEqual(4);
  });
});
