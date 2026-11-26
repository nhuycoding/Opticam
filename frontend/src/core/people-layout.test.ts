import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { exportBundle, normalizeLayout, parseBundle } from './io';
import { canPlacePerson } from './person';
import { buildZones, evaluate } from './optics';

describe('populated store layouts', () => {
  const populated = PRESETS.find(preset => preset.people?.length)!;
  it('provides customers and staff in valid floor locations', () => {
    expect(populated.people).toHaveLength(7);
    for (const person of populated.people!) expect(canPlacePerson(person.x, person.y, populated.widthM, populated.heightM, populated.obstacles, populated.floorPolygon), person.id).toBe(true);
    expect(withManualCams(populated).people).toEqual(populated.people);
  });
  it('round trips people in saved projects and supports older projects', () => {
    const loaded = parseBundle(exportBundle(populated, evaluate(populated, buildZones(populated)).score));
    expect(loaded.people).toEqual(populated.people);
    expect(normalizeLayout({ ...populated, people: undefined }).people).toBeUndefined();
  });
  it('rejects malformed, duplicate, exterior, and excessive people on import', () => {
    for (const people of [[null], [{ id: 'P', x: Number.NaN, y: 1 }], [{ id: 'P', x: 11, y: 4 }], [populated.people![0], populated.people![0]], Array.from({ length: 51 }, (_, i) => ({ id: String(i), x: 1, y: 1 }))]) {
      expect(() => normalizeLayout({ ...populated, people })).toThrow();
    }
  });
});
