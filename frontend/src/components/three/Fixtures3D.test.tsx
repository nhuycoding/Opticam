import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Block, Fixture3D } from './Fixtures3D';
import type { Obstacle } from '../../types';
import { buildShelfStock } from './ShelfProducts3D';

describe.each(['fridge', 'freezer'] as const)('%s roof geometry', fixture => {
  it.each([0.1, 0.9, 2.1, 3])('has one exposed top at height %s m', height => {
    const obstacle: Obstacle = { id: 'cabinet', type: 'shelf', fixture, label: 'Tủ', x: 1, y: 1, w: 2, h: 0.7, elev: height, angle: 15 };
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<Fixture3D obstacle={obstacle} selected={false} outline={[[0, 0], [10, 0], [10, 6], [0, 6]]} onSelect={vi.fn()} />); });
    try {
      const blocks = renderer.root.findAllByType(Block);
      const body = blocks.find(block => block.props.color === '#c9d6d4')!.props;
      const cap = blocks.find(block => block.props.color === '#728c88')!.props;
      const bodyTop = body.at[1] + body.size[1] / 2;
      const capBottom = cap.at[1] - cap.size[1] / 2;
      const capTop = cap.at[1] + cap.size[1] / 2;
      expect(body.size[1]).toBeGreaterThan(0);
      expect(bodyTop).toBeCloseTo(capBottom);
      expect(bodyTop).toBeLessThan(capTop - 0.01);
      expect(capTop).toBeCloseTo(height);
    } finally { act(() => renderer.unmount()); }
  });
});

describe('shelf product budget', () => {
  it.each([8, 24, 72])('fits items inside shelves with a %s product limit', limit => {
    const stock = buildShelfStock(4, 0.6, [0.15, 0.55, 0.95, 1.35, 1.8], 0.035, false, limit);
    expect(stock.itemCount).toBeGreaterThan(0);
    expect(stock.itemCount).toBeLessThanOrEqual(limit);
    expect(stock.cartons.length + stock.bottles.length).toBe(stock.itemCount);
    for (const part of [...stock.cartons, ...stock.bottles, ...stock.caps, ...stock.labels]) {
      expect(part.size.every(dimension => dimension > 0)).toBe(true);
      expect(Math.abs(part.at[0]) + part.size[0] / 2).toBeLessThan(2);
      expect(part.at[1]).toBeLessThan(1.8);
      expect(Math.abs(part.at[2])).toBeLessThan(0.3);
    }
  });

  it('omits stock on shelves too low or shallow to hold products', () => {
    expect(buildShelfStock(0.2, 0.1, [0.01, 0.03], 0.001, true, 72).itemCount).toBe(0);
  });
});
