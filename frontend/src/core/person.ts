import { pointInFloor, projectToSegment } from './footprint';
import type { Pt } from './geometry';
import type { Obstacle } from '../types';
import { distToObs } from './geometry';

export const PERSON_FOOTPRINT_RADIUS = 0.28;

export function canPlacePerson(
  x: number,
  y: number,
  roomW: number,
  roomH: number,
  obstacles: Obstacle[],
  floorPolygon?: Pt[]
): boolean {
  const radius = PERSON_FOOTPRINT_RADIUS;
  if (x < radius || y < radius || x > roomW - radius || y > roomH - radius) return false;
  if (floorPolygon && (!pointInFloor([x, y], floorPolygon) || floorPolygon.some((a, i) => projectToSegment([x, y], a, floorPolygon[(i + 1) % floorPolygon.length]).distance < radius))) return false;
  return obstacles.every((obstacle) =>
    obstacle.type === 'entrance' || distToObs(x, y, obstacle) >= radius
  );
}
