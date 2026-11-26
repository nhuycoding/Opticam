import { describe, expect, it } from 'vitest';
import type { Fixture, Layout, Obstacle } from '../types';
import { PRESETS } from '../data/presets';
import { addObstacle, moveObstacle, resizeObstacle, rotateObstacle } from './editor';
import { FIXTURE_VALUES, sizePresetsForObstacle } from './fixtures';
import { footprintFits } from './footprint';
import { obstacleFitsRoom, obsPoly, satCollide } from './geometry';

const room = (): Layout => ({ ...structuredClone(PRESETS[0]), obstacles: [], walkways: [{ label: 'Lối đi', points: [[1, 1], [2, 1]] }] });
const shelf: Obstacle = { id: 'shelf', type: 'shelf', label: 'Kệ', x: 2, y: 2, w: 4, h: 0.5, elev: 1.5, angle: 0 };
const neighbour: Obstacle = { id: 'other', type: 'pos', label: 'Quầy', x: 5.5, y: 2.6, w: 0.5, h: 0.5, elev: 1.1, angle: 0 };

describe('Fixture rotation and movement', () => {
  it('rotates through another fixture and clears stale walking routes', () => {
    const layout = { ...room(), obstacles: [shelf, neighbour] };
    expect(satCollide(obsPoly(shelf), obsPoly(neighbour))).toBe(false);
    const next = rotateObstacle(layout, shelf.id, 1);
    expect(next.obstacles[0].angle).toBe(15);
    expect(satCollide(obsPoly(next.obstacles[0]), obsPoly(neighbour))).toBe(true);
    expect(next.walkways).toBeUndefined();
    expect(layout.obstacles[0].angle).toBe(0);
  });

  it('allows an intersecting fixture to move gradually away while rejecting new collisions', () => {
    const third = { ...neighbour, id: 'third', x: 8, y: 2 };
    const rotated = rotateObstacle({ ...room(), obstacles: [shelf, neighbour, third] }, shelf.id, 1);
    const partial = moveObstacle(rotated, shelf.id, 4.25, 2.25);
    expect(partial).not.toBe(rotated);
    expect(satCollide(obsPoly(partial.obstacles[0]), obsPoly(neighbour))).toBe(true);
    const freed = moveObstacle(partial, shelf.id, 2, 1.5);
    expect(freed).not.toBe(partial);
    expect(satCollide(obsPoly(freed.obstacles[0]), obsPoly(neighbour))).toBe(false);
    expect(moveObstacle(freed, shelf.id, 8, 2.5)).toBe(freed);
  });

  it('retains real polygon boundaries when rotation needs an inward shift', () => {
    const layout: Layout = { ...room(), floorPolygon: [[0, 0], [10, 0], [10, 4], [6, 4], [6, 6], [0, 6]], obstacles: [{ ...shelf, x: 0, y: 0, w: 2, h: 1 }] };
    const next = rotateObstacle(layout, shelf.id, -1);
    expect(next.obstacles[0].angle).toBe(345);
    expect(obstacleFitsRoom(next.obstacles[0], layout.widthM, layout.heightM)).toBe(true);
    expect(footprintFits(next.obstacles[0], layout.floorPolygon)).toBe(true);
    expect(moveObstacle(next, shelf.id, 8, 5)).toBe(next);
  });

  it('rotates wall shelves and keeps their manually chosen angle during movement', () => {
    const layout = { ...room(), obstacles: [{ ...shelf, fixture: 'wall-shelf' as const, w: 2.4, h: 0.45 }] };
    const rotated = rotateObstacle(layout, shelf.id, 1);
    expect(rotated.obstacles[0].angle).toBe(15);
    const moved = moveObstacle(rotated, shelf.id, 4, 3);
    expect(moved.obstacles[0].angle).toBe(15);
    expect(moved.obstacles[0].y + moved.obstacles[0].h / 2).toBeCloseTo(3);
  });

  it('keeps doors attached to walls and ignores malformed drag coordinates', () => {
    const door: Obstacle = { ...neighbour, id: 'door', type: 'entrance', x: 1, y: 0, w: 1.5, h: 0.2 };
    const layout = { ...room(), obstacles: [door] };
    expect(rotateObstacle(layout, door.id, 1)).toBe(layout);
    expect(moveObstacle(layout, door.id, Number.NaN, 1)).toBe(layout);
    const moved = moveObstacle(layout, door.id, 10, 3);
    expect(moved.obstacles[0].angle).toBe(90);
    expect(obstacleFitsRoom(moved.obstacles[0], layout.widthM, layout.heightM)).toBe(true);
  });
});

describe('Specific fixture additions', () => {
  it.each([...FIXTURE_VALUES] as Fixture[])('adds a %s with its own geometry and presets', fixture => {
    const layout = room();
    const next = addObstacle(layout, 'shelf', fixture);
    expect(next).not.toBeNull();
    const obstacle = next!.obstacles[0];
    expect(obstacle.fixture).toBe(fixture);
    expect(obstacle.w).toBeGreaterThan(0);
    expect(obstacle.h).toBeGreaterThan(0);
    expect(obstacle.elev).toBeGreaterThan(0);
    expect(obstacleFitsRoom(obstacle, layout.widthM, layout.heightM)).toBe(true);
    const presets = sizePresetsForObstacle(obstacle, 3.2);
    expect(presets).toHaveLength(3);
    const small = resizeObstacle(next!, obstacle.id, presets[0].w, presets[0].h);
    expect(small.obstacles[0].w).toBeCloseTo(presets[0].w, 2);
  });

  it('resizes smoothly near walls without snapping center to 0.5m grid steps', () => {
    const nearWall: Obstacle = { id: 'nw', type: 'shelf', fixture: 'fridge', label: 'Tủ mát', x: 0.05, y: 1.15, w: 1.2, h: 0.7, elev: 2.0, angle: 0 };
    const layout = { ...room(), obstacles: [nearWall] };
    const bigger = resizeObstacle(layout, nearWall.id, 2.0, 0.85);
    expect(bigger.obstacles[0].w).toBeCloseTo(2.0, 2);
    expect(bigger.obstacles[0].h).toBeCloseTo(0.85, 2);
    expect(bigger.obstacles[0].x).toBeGreaterThanOrEqual(0);
    expect(bigger.obstacles[0].y + bigger.obstacles[0].h / 2).toBeCloseTo(1.5, 1);
  });
});
