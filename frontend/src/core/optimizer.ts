import { floorOutline, pointInFloor } from './footprint';
import { ceilingCameraHeight, ceilingHeightFor, normalizeCameraPlacement } from './camera';
import { canPlaceCeilingCamera } from './cameraEditing';
import { snapToWall, distToObs } from './geometry';
import type { Camera, Layout, OptimizationAlgorithm, Weight, Zone } from '../types';
import { snapAngle, wallAnchors } from './geometry';
import {
  blockerObstacles, DORI_FACTOR, DORI_MIN, doriOf, DUAL_HEIGHT_SCORING, dualEffectiveFactor, dualPpmAt,
  evaluate, FACE_Z, HAND_Z, RISK_RED_THRESHOLD, RISK_YELLOW_THRESHOLD, riskBand, type DualHeightConfig
} from './optics';

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

export interface Candidate { cam: Camera; ppm: Float32Array; handPpm?: Float32Array }
type Profile = Pick<Camera, 'fov' | 'res' | 'range' | 'height' | 'model' | 'tilt' | 'vfov' | 'ceilingDrop'>;
export interface CandOpts {
  anchorStep?: number;
  angleStep?: number;
  cameraProfile?: Profile;
  cameraProfiles?: Profile[];
  mounts?: 'wall' | 'mixed' | 'ceiling';
  algorithm?: OptimizationAlgorithm;
  dualHeight?: boolean;
  maxCandidateCells?: number;
  maxCandidates?: number;
  redTarget?: number;
  yellowTarget?: number;
  dualConfig?: Partial<DualHeightConfig>;
}
export interface OptimizationDiagnostics {
  algorithm: OptimizationAlgorithm;
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
  const faceH = l.targetHeight ?? FACE_Z, handH = Math.min(faceH, HAND_Z);
  const useDual = Boolean((opts.dualHeight ?? l.optimization?.dualHeight) && faceH > HAND_Z + 1e-6);
  for (const cam of poses) {
    if (!useDual) {
      const ppm = Float32Array.from(free, z => dualPpmAt(cam, z.cx, z.cy, obstacles, faceH, faceH, l.floorPolygon)[0]);
      if (ppm.some(p => p > 0)) out.push({ cam, ppm });
    } else {
      const ppm = new Float32Array(free.length), handPpm = new Float32Array(free.length);
      let any = false;
      for (let j = 0; j < free.length; j++) {
        const [fp, hp] = dualPpmAt(cam, free[j].cx, free[j].cy, obstacles, faceH, handH, l.floorPolygon);
        ppm[j] = fp; handPpm[j] = hp;
        if (fp > 0) any = true;
      }
      if (any) out.push({ cam, ppm, handPpm });
    }
  }
  return out;
}

/** Greedy baseline; optimizeCameras adds bounded one-camera replacement search. */
export function greedyPlace(l: Layout, zones: Zone[], K = 3, weighted = true, opts?: CandOpts): Camera[] {
  return optimizeCameras(l, zones, K, weighted, { ...opts, algorithm: 'greedy' }).cameras;
}

/** Build deduplicated per-slot candidate pools once so single-K and Min-K sweeps avoid redundant raycasting. */
export function prepareCandidateGroups(l: Layout, free: Zone[], K: number, opts: CandOpts): { groups: Candidate[][]; candidateCount: number } {
  const profiles = Array.from({ length: K }, (_, i) => profileOnly(opts.cameraProfiles?.[i] ?? opts.cameraProfile));
  const unique = new Set(profiles.map(p => JSON.stringify(p))).size || 1;
  const cache = new Map<string, Candidate[]>();
  const groups = profiles.map(profile => {
    const key = JSON.stringify(profile);
    if (!cache.has(key)) {
      cache.set(key, buildCandidates(l, free, {
        ...opts,
        cameraProfile: profile,
        maxCandidateCells: Math.max(free.length, Math.floor(1_500_000 / unique)),
        maxCandidates: Math.max(1, Math.floor(12_000 / unique))
      }));
    }
    return cache.get(key)!;
  });
  const candidateCount = [...cache.values()].reduce((n, c) => n + c.length, 0);
  return { groups, candidateCount };
}

/** Core Greedy + optional 3-pass 1-swap polish shared by fixed-K optimizeCameras and dedicated per-K search. */
export function solvePrepared(
  free: Zone[],
  weights: number[],
  groups: Candidate[][],
  K: number,
  algorithm: OptimizationAlgorithm,
  weighted: boolean,
  candidateCount: number,
  redTarget = 95,
  yellowTarget = 80,
  dualHeight = false,
  dualOverride?: Partial<DualHeightConfig>
): { cameras: Camera[]; diagnostics: OptimizationDiagnostics } {
  const started = performance.now();
  const isKpi = algorithm === 'kpi_hybrid' && weighted;
  const useDual = Boolean(dualHeight && weighted && groups.some(g => g.some(c => c.handPpm)));
  const lambdaRed = 1.5, lambdaYel = 0.75;
  const cfg: DualHeightConfig = dualOverride ? { ...DUAL_HEIGHT_SCORING, ...dualOverride } : DUAL_HEIGHT_SCORING;
  const { handMinPpm, minWeightForHandCheck, handTargetPct, lambdaHand } = cfg;
  const redMask = free.map(z => weighted && z.w >= RISK_RED_THRESHOLD);
  const yelMask = free.map(z => weighted && z.w >= RISK_YELLOW_THRESHOLD && z.w < RISK_RED_THRESHOLD);
  const handMask = free.map(z => weighted && z.w >= minWeightForHandCheck);
  const redN = redMask.filter(Boolean).length, yelN = yelMask.filter(Boolean).length;
  const handN = handMask.filter(Boolean).length;
  const totalW = weights.reduce((s, w) => s + w, 0);

  const selected: Array<{ candidate: Candidate; slot: number }> = [];
  const objective = (factors: Float32Array) => { let score = 0; for (let j = 0; j < factors.length; j++) score += weights[j] * factors[j]; return score; };
  const merge = (except = -1) => {
    const base = new Float32Array(free.length);
    const baseHand = useDual ? new Float32Array(free.length) : undefined;
    selected.forEach(({ candidate }, i) => {
      if (i !== except) for (let j = 0; j < base.length; j++) {
        if (candidate.ppm[j] > base[j]) base[j] = candidate.ppm[j];
        if (baseHand && candidate.handPpm && candidate.handPpm[j] > baseHand[j]) baseHand[j] = candidate.handPpm[j];
      }
    });
    const baseFactors = new Float32Array(free.length);
    for (let j = 0; j < base.length; j++) {
      baseFactors[j] = dualEffectiveFactor(weights[j], base[j], baseHand ? baseHand[j] : 0, useDual, cfg);
    }
    return { base, baseHand, baseFactors };
  };
  const baseKpiStats = (state: ReturnType<typeof merge>) => {
    const { base, baseHand } = state;
    let redOk = 0, yelOk = 0, handOk = 0;
    for (let j = 0; j < base.length; j++) {
      if (redMask[j] && base[j] >= DORI_MIN.identification) redOk++;
      if (yelMask[j] && base[j] >= DORI_MIN.recognition) yelOk++;
      if (useDual && handMask[j] && baseHand![j] >= handMinPpm) handOk++;
    }
    const redPct = redN ? (100 * redOk) / redN : 100;
    const yelPct = yelN ? (100 * yelOk) / yelN : 100;
    const handPct = useDual && handN ? (100 * handOk) / handN : 100;
    const hinge = totalW * 0.01 * (
      lambdaRed * Math.max(0, redTarget - redPct) +
      lambdaYel * Math.max(0, yellowTarget - yelPct) +
      (useDual ? lambdaHand * Math.max(0, handTargetPct - handPct) : 0)
    );
    return { redOk, yelOk, handOk, redPct, hinge };
  };
  // Lexicographic scoring: graded dual-height DORI (plus Stage-1 Red / soft hinge for kpi_hybrid) first, nominal PPM breaks ties.
  const addition = (state: ReturnType<typeof merge>, candidate: Candidate, stage1Red = false, stats?: ReturnType<typeof baseKpiStats>): [number, number] => {
    const { base, baseHand, baseFactors } = state;
    const candHand = candidate.handPpm;
    let deltaW = 0, tie = 0, addRed = 0, addYel = 0, addHand = 0;
    for (let j = 0; j < base.length; j++) {
      const fp = candidate.ppm[j];
      const hp = useDual && candHand ? candHand[j] : 0;
      if (fp <= base[j] && (!useDual || hp <= baseHand![j])) continue;
      const fNew = fp > base[j] ? fp : base[j];
      const hNew = useDual && hp > baseHand![j] ? hp : (baseHand ? baseHand[j] : 0);
      const factorNew = dualEffectiveFactor(weights[j], fNew, hNew, useDual, cfg);
      if (factorNew > baseFactors[j]) deltaW += weights[j] * (factorNew - baseFactors[j]);
      if (fNew > base[j]) {
        tie += weights[j] * (Math.min(fNew, 250) - Math.min(base[j], 250));
        if (isKpi) {
          if (redMask[j] && base[j] < DORI_MIN.identification && fNew >= DORI_MIN.identification) addRed++;
          if (yelMask[j] && base[j] < DORI_MIN.recognition && fNew >= DORI_MIN.recognition) addYel++;
        }
      }
      if (useDual && isKpi && handMask[j] && baseHand![j] < handMinPpm && hNew >= handMinPpm) addHand++;
    }
    if (!isKpi || !stats) return [deltaW, tie];
    if (stage1Red) return [addRed * (totalW / Math.max(1, redN)) + 0.1 * deltaW, tie];
    const newRedPct = redN ? (100 * (stats.redOk + addRed)) / redN : 100;
    const newYelPct = yelN ? (100 * (stats.yelOk + addYel)) / yelN : 100;
    const newHandPct = useDual && handN ? (100 * (stats.handOk + addHand)) / handN : 100;
    const newHinge = totalW * 0.01 * (
      lambdaRed * Math.max(0, redTarget - newRedPct) +
      lambdaYel * Math.max(0, yellowTarget - newYelPct) +
      (useDual ? lambdaHand * Math.max(0, handTargetPct - newHandPct) : 0)
    );
    return [deltaW + (stats.hinge - newHinge), tie];
  };

  const maxRedSlots = Math.max(1, Math.ceil(0.67 * K));
  for (let slot = 0; slot < K; slot++) {
    const state = merge(), used = new Set(selected.map(s => poseKey(s.candidate.cam)));
    const stats = isKpi ? baseKpiStats(state) : undefined;
    const stage1Red = Boolean(isKpi && redN > 0 && slot < maxRedSlots && stats!.redPct < redTarget);
    let best: Candidate | undefined, bestScore = -1, bestTie = -1;
    for (const candidate of groups[slot]) {
      if (used.has(poseKey(candidate.cam))) continue;
      const [score, tie] = addition(state, candidate, stage1Red, stats);
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && tie > bestTie + 1e-9)) { best = candidate; bestScore = score; bestTie = tie; }
    }
    if (best) selected.push({ candidate: best, slot });
  }
  const greedyScore = objective(merge().baseFactors);
  let iterations = 0;
  if (algorithm === 'hybrid' || algorithm === 'kpi_hybrid') for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let index = 0; index < selected.length; index++) {
      const state = merge(index), used = new Set(selected.filter((_, i) => i !== index).map(s => poseKey(s.candidate.cam)));
      const stats = isKpi ? baseKpiStats(state) : undefined;
      const old = selected[index], [oldGain, oldTie] = addition(state, old.candidate, false, stats);
      let best = old.candidate, bestGain = oldGain, bestTie = oldTie;
      for (const candidate of groups[old.slot]) {
        if (used.has(poseKey(candidate.cam))) continue;
        const [gain, tie] = addition(state, candidate, false, stats);
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && tie > bestTie + 1e-9)) { best = candidate; bestGain = gain; bestTie = tie; }
      }
      if (bestGain > oldGain + 1e-9) { selected[index] = { ...old, candidate: best }; improved = true; iterations++; }
    }
    if (!improved) break;
  }
  const cameras = selected.map(({ candidate }, i) => {
    let top = 1, gain = -1;
    free.forEach((z, j) => {
      const s = weights[j] * dualEffectiveFactor(weights[j], candidate.ppm[j], candidate.handPpm ? candidate.handPpm[j] : 0, useDual, cfg);
      if (s > gain) { gain = s; top = z.w; }
    });
    return { ...candidate.cam, id: `CAM-${String(i + 1).padStart(2, '0')}`, target: TARGET[riskBand(top)] };
  });
  return { cameras, diagnostics: { algorithm, greedyScore, finalScore: objective(merge().baseFactors), iterations, candidateCount, ms: performance.now() - started } };
}

export function optimizeCameras(l: Layout, zones: Zone[], K = 3, weighted = true, opts: CandOpts = {}): { cameras: Camera[]; diagnostics: OptimizationDiagnostics } {
  if (!Number.isInteger(K) || K < 0 || K > 20) throw new Error('Ngân sách camera phải là số nguyên từ 0 đến 20.');
  const started = performance.now(), algorithm = opts.algorithm ?? l.optimization?.algorithm ?? 'kpi_hybrid';
  const dualHeight = opts.dualHeight ?? l.optimization?.dualHeight ?? false;
  const free = zones.filter(z => !z.solid), weights = free.map(z => weighted ? z.w : 1);
  const { groups, candidateCount } = prepareCandidateGroups(l, free, K, { ...opts, dualHeight });
  const result = solvePrepared(free, weights, groups, K, algorithm, weighted, candidateCount, opts.redTarget ?? 95, opts.yellowTarget ?? 80, dualHeight, opts.dualConfig);
  return { ...result, diagnostics: { ...result.diagnostics, ms: performance.now() - started } };
}

export interface MinimumCameraSolution {
  cameras: Camera[];
  metTargets: boolean;
  red: number;
  yellow: number;
  diagnostics?: OptimizationDiagnostics;
}

/** Dedicated per-K KPI search reusing one shared candidate raycast pass across count = 1..M. */
export function minimumCamerasForTargets(l: Layout, zones: Zone[], cameraProfiles: Camera[], redTarget = 95, yellowTarget = 80, opts: CandOpts = {}): MinimumCameraSolution {
  const started = performance.now();
  const free = zones.filter(z => !z.solid), weights = free.map(z => z.w);
  const maxK = cameraProfiles.length;
  const minAlg: OptimizationAlgorithm = opts.algorithm ?? (l.optimization?.algorithm === 'greedy' ? 'greedy' : 'kpi_hybrid');
  const dualHeight = opts.dualHeight ?? l.optimization?.dualHeight ?? false;
  const { groups, candidateCount } = prepareCandidateGroups(l, free, maxK, { ...opts, cameraProfiles, dualHeight });

  let fallbackResult = solvePrepared(free, weights, groups, 0, minAlg, true, candidateCount, redTarget, yellowTarget, dualHeight, opts.dualConfig);
  let fallbackScore = evaluate({ ...l, cameras: fallbackResult.cameras }, zones, opts.dualConfig).score;

  for (let count = 1; count <= maxK; count++) {
    const stepResult = solvePrepared(free, weights, groups.slice(0, count), count, minAlg, true, candidateCount, redTarget, yellowTarget, dualHeight, opts.dualConfig);
    const score = evaluate({ ...l, cameras: stepResult.cameras }, zones, opts.dualConfig).score;
    fallbackResult = stepResult;
    fallbackScore = score;
    if (score.red >= redTarget && score.yellow >= yellowTarget) {
      return {
        cameras: stepResult.cameras,
        metTargets: true,
        red: score.red,
        yellow: score.yellow,
        diagnostics: { ...stepResult.diagnostics, ms: performance.now() - started }
      };
    }
  }
  return {
    cameras: fallbackResult.cameras,
    metTargets: false,
    red: fallbackScore.red,
    yellow: fallbackScore.yellow,
    diagnostics: { ...fallbackResult.diagnostics, ms: performance.now() - started }
  };
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
