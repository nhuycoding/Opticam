import { floorOutline, pointInFloor } from './footprint';
import { ceilingCameraHeight, ceilingHeightFor, normalizeCameraPlacement } from './camera';
import { canPlaceCeilingCamera } from './cameraEditing';
import { snapToWall, distToObs } from './geometry';
import type { Camera, Layout, Weight, Zone } from '../types';
import { snapAngle, wallAnchors } from './geometry';
import { blockerObstacles, DORI_FACTOR, doriOf, evaluate, ppmAt, riskBand } from './optics';

export const makeCamera = (id: string, x: number, y: number, pan: number): Camera =>
  ({ id, x, y, pan: snapAngle(pan), fov: 85, res: 2560, range: 10, height: 2.4, model: 'Dome IP 4MP (2560px, ống kính 2.8mm)' });

/** Baseline 1: 4 camera ở 4 góc tường theo thói quen thợ lắp đặt. */
export const manualFourCorners = (l: Layout): Camera[] => [
  makeCamera('CAM-01', 0, 0, 45), makeCamera('CAM-02', l.widthM, 0, 135),
  makeCamera('CAM-03', l.widthM, l.heightM, 225), makeCamera('CAM-04', 0, l.heightM, 315)
 ].map((c) => {
  if (!l.floorPolygon) return { ...c, target: 'Góc tường (đặt thủ công)' };
  const [x, y] = snapToWall(c.x, c.y, l.widthM, l.heightM, l.gridM, l.floorPolygon);
  const points = floorOutline(l);
  const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return { ...c, x, y, pan: snapAngle(Math.atan2(cy - y, cx - x) * 180 / Math.PI), target: 'Tường bao (đặt thủ công)' };
}).map(camera => normalizeCameraPlacement(camera, l));

const TARGET = { red: 'Vùng trọng yếu', yellow: 'Vùng ưu tiên', green: 'Lối đi chung' } as const;
const F = (p: number) => DORI_FACTOR[doriOf(p)];

export interface Candidate { cam: Camera; ppm: Float32Array }
type Profile = Pick<Camera, 'fov' | 'res' | 'range' | 'height' | 'model' | 'tilt' | 'vfov' | 'ceilingDrop'>;
export interface CandOpts {
  anchorStep?: number;
  angleStep?: number;
  cameraProfile?: Profile;
  cameraProfiles?: Profile[];
  mounts?: 'wall' | 'mixed' | 'ceiling';
  algorithm?: 'greedy' | 'hybrid';
  maxCandidateCells?: number;
  maxCandidates?: number;
}
export interface OptimizationDiagnostics {
  algorithm: 'greedy' | 'hybrid';
  greedyScore: number;
  finalScore: number;
  iterations: number;
  candidateCount: number;
  ms: number;
}
const poseKey = (c: Camera) => [c.mount ?? 'wall', c.x, c.y, c.pan, c.tilt ?? 20, c.height].join('/');
const profileOnly = (p?: Profile): Profile | undefined => p && ({ fov: p.fov, res: p.res, range: p.range, height: p.height, model: p.model, tilt: p.tilt, vfov: p.vfov, ceilingDrop: p.ceilingDrop });

/** Bounded, deterministic wall/ceiling sampling. Both solvers use exactly this pool. */
export function buildCandidates(l: Layout, free: Zone[], opts: CandOpts = {}): Candidate[] {
  let step = opts.anchorStep ?? Math.max(l.gridM, 0.5);
  const angleStep = opts.angleStep ?? 30;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(angleStep) || angleStep <= 0) throw new Error('Bước lấy mẫu phải lớn hơn 0.');
  if (!free.length) return [];
  const mounts = opts.mounts ?? l.optimization?.mounts ?? 'mixed';
  const profile = opts.cameraProfile, obstacles = blockerObstacles(l);
  const ceilingHeight = ceilingHeightFor(l), drop = profile?.ceilingDrop ?? 0.15;
  const wallTilt = profile?.tilt ?? 20;
  const wallTilts = [...new Set([wallTilt, Math.max(0, wallTilt - 15), Math.min(90, wallTilt + 15)])];
  const ceilingTilts = [...new Set([35, 55, 75, 90, ...(profile?.tilt !== undefined ? [profile.tilt] : [])])];
  const configurations = (spacing: number): Camera[] => {
    const result: Camera[] = [];
    const add = (x: number, y: number, mount: 'wall' | 'ceiling', tilts: number[]) => {
      const defaults = makeCamera('', x, y, 0);
      const height = mount === 'ceiling' ? ceilingCameraHeight(l, drop) : Math.min(profile?.height ?? defaults.height, ceilingHeight - 0.3);
      if (mount === 'ceiling' ? !canPlaceCeilingCamera({ ...defaults, x, y, height }, l) : obstacles.some(o => o.elev >= height - 0.08 && distToObs(x, y, o) < 0.12)) return;
      for (const tilt of tilts) for (let pan = 0; pan < 360; pan += angleStep) {
        result.push({ ...defaults, ...profileOnly(profile), x, y, pan, mount, height, tilt, ...(mount === 'ceiling' ? { ceilingDrop: drop } : {}) });
      }
    };
    if (mounts !== 'ceiling') for (const [x, y] of wallAnchors(l.widthM, l.heightM, spacing, l.floorPolygon)) add(x, y, 'wall', wallTilts);
    if (mounts !== 'wall') {
      const nx = Math.max(1, Math.ceil(l.widthM / Math.max(1, spacing))), ny = Math.max(1, Math.ceil(l.heightM / Math.max(1, spacing)));
      for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
        const x = l.widthM * (ix + 0.5) / nx, y = l.heightM * (iy + 0.5) / ny;
        if (!l.floorPolygon || pointInFloor([x, y], l.floorPolygon)) add(x, y, 'ceiling', ceilingTilts);
      }
    }
    return result;
  };
  const cap = Math.max(1, Math.min(opts.maxCandidates ?? 12_000, Math.floor((opts.maxCandidateCells ?? 1_500_000) / free.length)));
  let poses = configurations(step);
  while (poses.length > cap && step < Math.max(l.widthM, l.heightM) * 2) { step *= 2; poses = configurations(step); }
  // In dense rooms even the corner orientations may exceed the budget. Sample evenly.
  if (poses.length > cap) poses = Array.from({ length: cap }, (_, i) => poses[Math.floor(i * poses.length / cap)]);
  const out: Candidate[] = [];
  for (const cam of poses) {
    const ppm = Float32Array.from(free, z => ppmAt(cam, z.cx, z.cy, obstacles, l.targetHeight, l.floorPolygon));
    if (ppm.some(p => p > 0)) out.push({ cam, ppm });
  }
  return out;
}

/** Greedy baseline; optimizeCameras adds bounded one-camera replacement search. */
export function greedyPlace(l: Layout, zones: Zone[], K = 3, weighted = true, opts?: CandOpts): Camera[] {
  return optimizeCameras(l, zones, K, weighted, { ...opts, algorithm: 'greedy' }).cameras;
}

export function optimizeCameras(l: Layout, zones: Zone[], K = 3, weighted = true, opts: CandOpts = {}): { cameras: Camera[]; diagnostics: OptimizationDiagnostics } {
  if (!Number.isInteger(K) || K < 0 || K > 20) throw new Error('Ngân sách camera phải là số nguyên từ 0 đến 20.');
  const started = performance.now(), algorithm = opts.algorithm ?? l.optimization?.algorithm ?? 'hybrid';
  const free = zones.filter(z => !z.solid), weights = free.map(z => weighted ? z.w : 1);
  const profiles = Array.from({ length: K }, (_, i) => profileOnly(opts.cameraProfiles?.[i] ?? opts.cameraProfile));
  const unique = new Set(profiles.map(p => JSON.stringify(p))).size || 1;
  const cache = new Map<string, Candidate[]>();
  const groups = profiles.map(profile => {
    const key = JSON.stringify(profile);
    if (!cache.has(key)) cache.set(key, buildCandidates(l, free, { ...opts, cameraProfile: profile, maxCandidateCells: Math.max(free.length, Math.floor(1_500_000 / unique)), maxCandidates: Math.max(1, Math.floor(12_000 / unique)) }));
    return cache.get(key)!;
  });
  const selected: Array<{ candidate: Candidate; slot: number }> = [];
  const objective = (ppm: Float32Array) => { let score = 0; for (let j = 0; j < ppm.length; j++) score += weights[j] * F(ppm[j]); return score; };
  const merge = (except = -1) => {
    const result = new Float32Array(free.length);
    selected.forEach(({ candidate }, i) => { if (i !== except) for (let j = 0; j < result.length; j++) result[j] = Math.max(result[j], candidate.ppm[j]); });
    return result;
  };
  // Lexicographic scoring: exact DORI objective first, nominal PPM only breaks ties.
  const addition = (base: Float32Array, candidate: Candidate): [number, number] => {
    let score = 0, tie = 0;
    for (let j = 0; j < base.length; j++) {
      const p = candidate.ppm[j];
      if (p > base[j]) { score += weights[j] * (F(p) - F(base[j])); tie += weights[j] * (Math.min(p, 250) - Math.min(base[j], 250)); }
    }
    return [score, tie];
  };
  for (let slot = 0; slot < K; slot++) {
    const base = merge(), used = new Set(selected.map(s => poseKey(s.candidate.cam)));
    let best: Candidate | undefined, bestScore = -1, bestTie = -1;
    for (const candidate of groups[slot]) {
      if (used.has(poseKey(candidate.cam))) continue;
      const [score, tie] = addition(base, candidate);
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && tie > bestTie + 1e-9)) { best = candidate; bestScore = score; bestTie = tie; }
    }
    if (best) selected.push({ candidate: best, slot });
  }
  const greedyScore = objective(merge());
  let iterations = 0;
  if (algorithm === 'hybrid') for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let index = 0; index < selected.length; index++) {
      const base = merge(index), used = new Set(selected.filter((_, i) => i !== index).map(s => poseKey(s.candidate.cam)));
      const old = selected[index], oldGain = addition(base, old.candidate)[0];
      let best = old.candidate, bestGain = oldGain, bestTie = addition(base, old.candidate)[1];
      for (const candidate of groups[old.slot]) {
        if (used.has(poseKey(candidate.cam))) continue;
        const [gain, tie] = addition(base, candidate);
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && tie > bestTie + 1e-9)) { best = candidate; bestGain = gain; bestTie = tie; }
      }
      // Accept only strict DORI improvements; ties are deterministic inside the search.
      if (bestGain > oldGain + 1e-9) { selected[index] = { ...old, candidate: best }; improved = true; iterations++; }
    }
    if (!improved) break;
  }
  const cameras = selected.map(({ candidate }, i) => {
    let top = 1, gain = -1;
    free.forEach((z, j) => { const s = weights[j] * F(candidate.ppm[j]); if (s > gain) { gain = s; top = z.w; } });
    return { ...candidate.cam, id: `CAM-${String(i + 1).padStart(2, '0')}`, target: TARGET[riskBand(top)] };
  });
  return { cameras, diagnostics: { algorithm, greedyScore, finalScore: objective(merge()), iterations, candidateCount: [...cache.values()].reduce((n, c) => n + c.length, 0), ms: performance.now() - started } };
}

export interface MinimumCameraSolution {
  cameras: Camera[];
  metTargets: boolean;
  red: number;
  yellow: number;
  diagnostics?: OptimizationDiagnostics;
}

/** Shortest prefix of the optimized solution meeting both KPIs; not a global minimum certificate. */
export function minimumCamerasForTargets(l: Layout, zones: Zone[], cameraProfiles: Camera[], redTarget = 95, yellowTarget = 80): MinimumCameraSolution {
  const result = optimizeCameras(l, zones, cameraProfiles.length, true, { cameraProfiles });
  let bestScore = evaluate({ ...l, cameras: result.cameras }, zones).score;
  for (let count = 1; count <= result.cameras.length; count++) {
    const cameras = result.cameras.slice(0, count), score = evaluate({ ...l, cameras }, zones).score;
    if (score.red >= redTarget && score.yellow >= yellowTarget) return { cameras, metTargets: true, red: score.red, yellow: score.yellow };
    if (count === result.cameras.length) bestScore = score;
  }
  return { cameras: result.cameras, metTargets: false, red: bestScore.red, yellow: bestScore.yellow, diagnostics: result.diagnostics };
}

/**
 * Vét cạn (nghiệm tối ưu chính xác TRONG tập ứng viên cho trước) cho K ≤ 3.
 * Hàm mục tiêu: Σ W·F(max PPM) trên ô sàn trống — đúng như evaluate().weighted.
 */
export function bruteForce(l: Layout, zones: Zone[], K: 1 | 2 | 3, opts?: CandOpts): { cameras: Camera[]; objective: number; evaluated: number } {
  const free = zones.filter((z) => !z.solid), w = Float32Array.from(free.map((z) => z.w));
  const cands = buildCandidates(l, free, opts), n = cands.length, m = free.length;
  const fa = cands.map((c) => Float32Array.from(c.ppm, (p) => F(p)));
  let best = -1, bi: number[] = [], evaluated = 0;
  const sum = (a: Float32Array) => { let s = 0; for (let j = 0; j < m; j++) s += w[j] * a[j]; return s; };
  const tmp2 = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    if (K === 1) { evaluated++; const s = sum(fa[i]); if (s > best) { best = s; bi = [i]; } continue; }
    for (let j = i + 1; j < n; j++) {
      for (let t = 0; t < m; t++) tmp2[t] = Math.max(fa[i][t], fa[j][t]);
      if (K === 2) { evaluated++; const s = sum(tmp2); if (s > best) { best = s; bi = [i, j]; } continue; }
      for (let k = j + 1; k < n; k++) {
        evaluated++; const f = fa[k]; let s = 0;
        for (let t = 0; t < m; t++) s += w[t] * (tmp2[t] > f[t] ? tmp2[t] : f[t]);
        if (s > best) { best = s; bi = [i, j, k]; }
      }
    }
  }
  return { cameras: bi.map((c, q) => ({ ...cands[c].cam, id: `CAM-0${q + 1}` })), objective: best, evaluated };
}
