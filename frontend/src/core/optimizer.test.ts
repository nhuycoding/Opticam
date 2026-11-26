import { describe, expect, it } from 'vitest';
import { withManualCams, PRESETS } from '../data/presets';
import { pointInFloor } from './footprint';
import { buildZones, evaluate } from './optics';
import { buildCandidates, greedyPlace, minimumCamerasForTargets, optimizeCameras } from './optimizer';

const base = () => ({ ...withManualCams(PRESETS[0]), widthM: 4, heightM: 3, gridM: 1, obstacles: [], cameras: [] });

describe('Wall and ceiling placement search', () => {
  it('samples both installation surfaces, changes pitch and respects the physical ceiling', () => {
    const l = { ...base(), ceilingHeight: 3.6 };
    const candidates = buildCandidates(l, buildZones(l));
    expect(new Set(candidates.map(({ cam }) => cam.mount))).toEqual(new Set(['wall', 'ceiling']));
    const ceiling = candidates.filter(({ cam }) => cam.mount === 'ceiling');
    expect(ceiling.length).toBeGreaterThan(0);
    expect(ceiling.every(({ cam }) => Math.abs(cam.height - 3.45) < 1e-9)).toBe(true);
    expect(new Set(ceiling.map(({ cam }) => cam.tilt)).size).toBeGreaterThan(1);
  });
  it('keeps ceiling anchors in concave floor polygons and out of columns at lens height', () => {
    const l = { ...base(), widthM: 6, heightM: 6, floorPolygon: [[0,0],[6,0],[6,3],[3,3],[3,6],[0,6]] as [number,number][], obstacles: [{ id:'column', type:'shelf' as const, label:'Column', x:0,y:0,w:2,h:2,elev:4,angle:0 }] };
    const candidates = buildCandidates(l, buildZones(l), { mounts:'ceiling' });
    expect(candidates.length).toBeGreaterThan(0);
    for (const { cam } of candidates) {
      expect(pointInFloor([cam.x,cam.y],l.floorPolygon)).toBe(true);
      expect(cam.x<=2 && cam.y<=2).toBe(false);
    }
  });
  it('improves a real store over Greedy using the identical candidate pool', () => {
    const l = withManualCams(PRESETS[2]), zones = buildZones(l);
    const greedy = optimizeCameras(l,zones,3,true,{algorithm:'greedy'});
    const hybrid = optimizeCameras(l,zones,3,true,{algorithm:'hybrid'});
    expect(hybrid.diagnostics.candidateCount).toBe(greedy.diagnostics.candidateCount);
    expect(hybrid.diagnostics.greedyScore).toBeCloseTo(greedy.diagnostics.finalScore,8);
    expect(hybrid.diagnostics.iterations).toBeGreaterThan(0);
    expect(hybrid.diagnostics.finalScore).toBeGreaterThan(greedy.diagnostics.finalScore);
    expect(evaluate({...l,cameras:hybrid.cameras},zones).score.weighted).toBeGreaterThan(evaluate({...l,cameras:greedy.cameras},zones).score.weighted);
    // Golden fixture also checked in the backend: parity of pose/pitch and objective.
    expect(hybrid.diagnostics.finalScore).toBeCloseTo(508.17339711675044,6);
    expect(hybrid.cameras.map(c=>[c.mount,c.x,c.y,c.pan,c.tilt])).toEqual([
      ['wall',7.5,0,120,35],['ceiling',1.4166666666666667,5.5,330,35],['wall',4.5,0,150,20]
    ]);
  });
  it.each(['wall','ceiling','mixed'] as const)('keeps %s search deterministic, distinct and no worse than its baseline', (mounts) => {
    const l={...base(),optimization:{mounts,algorithm:'hybrid' as const}}, zones=buildZones(l);
    const result=optimizeCameras(l,zones,3);
    expect(result.cameras).toEqual(optimizeCameras(l,zones,3).cameras);
    expect(result.diagnostics.finalScore).toBeGreaterThanOrEqual(result.diagnostics.greedyScore-1e-9);
    expect(new Set(result.cameras.map(c=>[c.mount,c.x,c.y,c.pan,c.tilt].join('/'))).size).toBe(result.cameras.length);
    if(mounts!=='mixed')expect(result.cameras.every(c=>c.mount===mounts)).toBe(true);
    expect(greedyPlace(l,zones,3)).toHaveLength(result.cameras.length);
  });
  it('bounds dense pool memory and supports an empty/unobservable room', () => {
    const l={...base(),widthM:40,heightM:30,gridM:.32};
    const zones=buildZones(l);
    expect(buildCandidates(l,zones).length*zones.length).toBeLessThanOrEqual(1_500_000);
    expect(optimizeCameras(l,zones.map(z=>({...z,solid:true})),3).cameras).toEqual([]);
  });
  it('promotes Two-Stage kpi_hybrid (T2) and dedicated per-K minimumCamerasForTargets (T3) with cross-stack parity', () => {
    const circleK = withManualCams(PRESETS[1]), zCK = buildZones(circleK);
    const ckBase = optimizeCameras(circleK, zCK, 3, true, { algorithm: 'hybrid' });
    const ckKpi = optimizeCameras(circleK, zCK, 3, true, { algorithm: 'kpi_hybrid' });
    expect(evaluate({ ...circleK, cameras: ckBase.cameras }, zCK).score.red).toBeLessThan(95);
    const ckScore = evaluate({ ...circleK, cameras: ckKpi.cameras }, zCK).score;
    expect(ckScore.red).toBeGreaterThanOrEqual(95);
    expect(ckScore.yellow).toBeGreaterThanOrEqual(80);
    expect(ckKpi.diagnostics.finalScore).toBeCloseTo(655.8522728639972, 6);
    expect(ckKpi.cameras.map(c => [c.mount, Number(c.x.toFixed(4)), c.y, c.pan, c.tilt])).toEqual([
      ['ceiling', 5.2885, 5.5, 210, 35], ['ceiling', 12.0192, 5.5, 240, 35], ['ceiling', 4.3269, 5.5, 330, 35]
    ]);

    const mini = withManualCams(PRESETS[2]), zM = buildZones(mini);
    const profiles = Array.from({ length: 6 }, (_, i) => mini.cameras[i] ?? { ...mini.cameras[0], id: `CAM-0${i + 1}` });
    const minSol = minimumCamerasForTargets(mini, zM, profiles);
    expect(minSol.metTargets).toBe(true);
    expect(minSol.cameras.length).toBeLessThanOrEqual(3);
    expect(minSol.red).toBeGreaterThanOrEqual(95);
    expect(minSol.yellow).toBeGreaterThanOrEqual(80);
  });
});
