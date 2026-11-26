import { pointInFloor, segmentInFloor } from './footprint';
import { PERSON_REGIONS, type Camera, type Cell, type Dori, type Layout, type Obstacle, type PersonRegion, type Score, type ShelfRiskCategory, type Weight, type Zone } from '../types';
import { distToObs, rad, segmentRectInterval, type Pt } from './geometry';
import { cameraProjection } from './camera';

/** Ngưỡng DORI theo IEC 62676-4 (PPM) */
export const DORI_MIN = { identification: 250, recognition: 125, observation: 62.5, detection: 25 } as const;
export const DORI_FACTOR: Record<Dori, number> = { identification: 1, recognition: 0.75, observation: 0.4, detection: 0.2, blind: 0 };
export const RISK_RED_THRESHOLD = 4;
export const RISK_YELLOW_THRESHOLD = 2;
export const REQUIRED_PPM = { red: DORI_MIN.identification, yellow: DORI_MIN.recognition, green: DORI_MIN.observation } as const;
export const FACE_Z = 1.6;            // mặt phẳng khuôn mặt (m)
export const HAND_Z = 1.0;            // mặt phẳng tầm tay / hàng hóa (m)

export interface DualHeightConfig {
  handMinPpm: number;
  handFullPpm: number;
  handDetectPpm: number;
  handTierMultipliers: readonly [number, number, number, number];
  redFaceShare: number;
  yellowFaceShare: number;
  minWeightForHandCheck: number;
  handTargetPct: number;
  lambdaHand: number;
}

/** Explicit, fine-tunable parameters for graded dual-height (1.6 m + 1.0 m) scoring. */
export const DUAL_HEIGHT_SCORING: DualHeightConfig = {
  handMinPpm: DORI_MIN.observation,       // 62.5 PPM Observation threshold at 1.0 m
  handFullPpm: DORI_MIN.recognition,      // 125 PPM Recognition threshold for full hand credit
  handDetectPpm: DORI_MIN.detection,      // 25 PPM Detection floor (below => head-only occluded)
  handTierMultipliers: [0, 0.5, 0.85, 1.0] as const,
  redFaceShare: 0.65,                     // tuned: credit kept from 1.6 m face on Red (W >= 4) when hand is blind
  yellowFaceShare: 0.80,                  // tuned: credit kept from 1.6 m face on Yellow (3 <= W < 4) when hand is blind
  minWeightForHandCheck: 3.0,             // tuned: covers Red + standard/high shelf cores (skips outer <3 tails & bulky)
  handTargetPct: 80,                      // tuned: soft KPI target (%) at 1.0 m for priority cells
  lambdaHand: 0.50,                       // tuned: hinge weight balancing 1.0 m protection with 1.6 m KPI preservation
};

export function handVisibilityMultiplier(handPpm: number, cfg: DualHeightConfig = DUAL_HEIGHT_SCORING): number {
  const [blindM, detectM, obsM, recM] = cfg.handTierMultipliers;
  if (handPpm >= cfg.handFullPpm) return recM;
  if (handPpm >= cfg.handMinPpm) return obsM;
  if (handPpm >= cfg.handDetectPpm) return detectM;
  return blindM;
}

export function dualEffectiveFactor(
  weight: number,
  facePpm: number,
  handPpm: number,
  enforceDual: boolean,
  cfg: DualHeightConfig = DUAL_HEIGHT_SCORING
): number {
  const faceFactor = DORI_FACTOR[doriOf(facePpm)];
  if (!enforceDual || faceFactor <= 0 || weight < cfg.minWeightForHandCheck) return faceFactor;
  const faceShare = weight >= RISK_RED_THRESHOLD ? cfg.redFaceShare : cfg.yellowFaceShare;
  return faceFactor * (faceShare + (1 - faceShare) * handVisibilityMultiplier(handPpm, cfg));
}
export const RISK_DEFAULTS = {
  pos: { wmax: 5, r0: 1, radius: 2.5 },
  entrance: { wmax: 5, r0: 1, radius: 2.5 },
  shelf: { wmax: 3, r0: 1, radius: 2 }
} as const;
export const SHELF_RISK_PROFILES: Record<ShelfRiskCategory, { wmax: number; label: string }> = {
  high: { wmax: 4.5, label: 'CRAVED cao' },
  standard: { wmax: 3, label: 'Hàng thông thường' },
  bulky: { wmax: 1.8, label: 'Hàng cồng kềnh' },
  custom: { wmax: 3, label: 'Tùy chỉnh' }
};

export const obstacleRiskWmax = (obstacle: Obstacle): number =>
  obstacle.riskWmax ?? (obstacle.type === 'shelf'
    ? SHELF_RISK_PROFILES[obstacle.riskCategory ?? 'standard'].wmax
    : RISK_DEFAULTS[obstacle.type].wmax);

export const riskBand = (weight: number): 'red' | 'yellow' | 'green' =>
  weight >= RISK_RED_THRESHOLD ? 'red' : weight >= RISK_YELLOW_THRESHOLD ? 'yellow' : 'green';

export const riskWeightAt = (distance: number, wmax: number, r0: number, radius: number): number => {
  if (radius <= r0 || distance <= r0) return wmax;
  if (distance >= radius) return 1;
  const t = (distance - r0) / (radius - r0);
  return 1 + (wmax - 1) * (1 - t);
};

export const doriOf = (ppm: number): Dori =>
  ppm >= DORI_MIN.identification ? 'identification' : ppm >= DORI_MIN.recognition ? 'recognition'
  : ppm >= DORI_MIN.observation ? 'observation' : ppm >= DORI_MIN.detection ? 'detection' : 'blind';

/** All solid obstacles can block a target when the 3D sightline intersects their height. */
export const blockerObstacles = (l: Layout): Obstacle[] => l.obstacles.filter((o) => o.type !== 'entrance');

/** Nominal horizontal pixel density at a 3D camera-to-target distance. */
export function pixelsPerMeterAtDistance(resolution: number, horizontalFov: number, distance: number): number {
  return resolution / (2 * Math.max(0.001, distance) * Math.tan(rad(horizontalFov / 2)));
}

/** Dual-height 3D PPM sharing one 2D floor & XY ray-AABB intersection pass for face (1.6 m) and hand (1.0 m). */
export function dualPpmAt(
  cam: Camera, x: number, y: number, obstacles: Obstacle[],
  faceHeight = FACE_Z, handHeight = HAND_Z, floorPolygon?: Pt[]
): [number, number] {
  if (floorPolygon && !segmentInFloor([cam.x, cam.y], [x, y], floorPolygon)) return [0, 0];
  const dx = x - cam.x, dy = y - cam.y, dXY2 = dx * dx + dy * dy;
  const dzF = faceHeight - cam.height, dzH = handHeight - cam.height;
  const rF = Math.hypot(dx, dy, dzF), rH = handHeight === faceHeight ? rF : Math.sqrt(dXY2 + dzH * dzH);
  const fInRange = rF >= 0.03 && rF <= cam.range;
  const hInRange = handHeight !== faceHeight && rH >= 0.03 && rH <= cam.range;
  if (!fInRange && !hInRange) return [0, 0];

  const { tilt, vfov } = cameraProjection(cam), pan = rad(cam.pan), pitch = rad(tilt);
  const cosP = Math.cos(pan), sinP = Math.sin(pan), cosT = Math.cos(pitch), sinT = Math.sin(pitch);
  const tanH = Math.tan(rad(cam.fov / 2)), tanV = Math.tan(rad(vfov / 2));
  const along = dx * cosP + dy * sinP, right = -dx * sinP + dy * cosP;

  const checkFrustum = (dz: number) => {
    const depth = along * cosT - dz * sinT;
    const up = along * sinT + dz * cosT;
    return depth > 0 && Math.abs(right) <= depth * tanH + 1e-9 && Math.abs(up) <= depth * tanV + 1e-9;
  };
  let okF = fInRange && checkFrustum(dzF);
  let okH = hInRange && checkFrustum(dzH);
  if (!okF && !okH) return [0, 0];

  const start: Pt = [cam.x, cam.y], end: Pt = [x, y];
  for (const o of obstacles) {
    if (o.elev <= 0) continue;
    const interval = segmentRectInterval(start, end, o);
    if (!interval) continue;
    const [t0, t1] = interval;
    if (okF && Math.min(cam.height + dzF * t0, cam.height + dzF * t1) <= o.elev + 1e-9) okF = false;
    if (okH && Math.min(cam.height + dzH * t0, cam.height + dzH * t1) <= o.elev + 1e-9) okH = false;
    if (!okF && !okH) return [0, 0];
  }
  const fPpm = okF ? pixelsPerMeterAtDistance(cam.res, cam.fov, rF) : 0;
  const hPpm = handHeight === faceHeight ? fPpm : (okH ? pixelsPerMeterAtDistance(cam.res, cam.fov, rH) : 0);
  return [fPpm, hPpm];
}

/** PPM uses the selected person height and blocks sightlines intersecting an obstacle volume. */
export function ppmAt(cam: Camera, x: number, y: number, obstacles: Obstacle[], targetHeight = FACE_Z, floorPolygon?: Pt[]): number {
  return dualPpmAt(cam, x, y, obstacles, targetHeight, targetHeight, floorPolygon)[0];
}

export function assessPersonAt(l: Layout, x: number, y: number): Array<PersonRegion & { ppm: number; dori: Dori }> {
  const obstacles = blockerObstacles(l);
  return PERSON_REGIONS.map((region) => {
    const ppm = l.cameras.reduce(
      (best, cam) => Math.max(best, ppmAt(cam, x, y, obstacles, region.height, l.floorPolygon)),
      0
    );
    return { ...region, ppm, dori: doriOf(ppm) };
  });
}

/** Rule-based Semantic Object Mapping + Manual Risk Brush → lưới ô 0.5m × 0.5m. Chỉ phụ thuộc vật cản/cọ tô, không phụ thuộc camera. */
export function buildZones(l: Layout): Zone[] {
  const cols = Math.round(l.widthM / l.gridM), rows = Math.round(l.heightM / l.gridM);
  const zones: Zone[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = (c + 0.5) * l.gridM, cy = (r + 0.5) * l.gridM;
    const solid = (l.floorPolygon && !pointInFloor([cx, cy], l.floorPolygon)) || l.obstacles.some((o) => o.type !== 'entrance' && distToObs(cx, cy, o) < 1e-9);
    let w: Weight = 1;
    for (const obstacle of l.obstacles) {
      const defaults = RISK_DEFAULTS[obstacle.type];
      const obstacleWeight = riskWeightAt(
        distToObs(cx, cy, obstacle),
        obstacleRiskWmax(obstacle),
        obstacle.riskR0 ?? defaults.r0,
        obstacle.riskR ?? defaults.radius
      );
      w = Math.max(w, obstacleWeight);
    }
    const legacyOverride = l.risk[`${r}_${c}`];
    if (Number.isFinite(legacyOverride)) w = legacyOverride;
    zones.push({ r, c, cx, cy, w, solid: Boolean(solid) });
  }
  for (const stroke of l.riskStrokes) {
    const minCol = Math.max(0, Math.ceil((stroke.x - stroke.radius) / l.gridM - 0.5));
    const maxCol = Math.min(cols - 1, Math.floor((stroke.x + stroke.radius) / l.gridM - 0.5));
    const minRow = Math.max(0, Math.ceil((stroke.y - stroke.radius) / l.gridM - 0.5));
    const maxRow = Math.min(rows - 1, Math.floor((stroke.y + stroke.radius) / l.gridM - 0.5));
    for (let r = minRow; r <= maxRow; r++) for (let c = minCol; c <= maxCol; c++) {
      const zone = zones[r * cols + c];
      if (Math.hypot(zone.cx - stroke.x, zone.cy - stroke.y) <= stroke.radius) zone.w = stroke.weight;
    }
  }
  return zones;
}

export function evaluate(l: Layout, zones: Zone[], dualOverride?: Partial<DualHeightConfig>): { cells: Cell[]; score: Score } {
  const t0 = performance.now();
  const obstacles = blockerObstacles(l);
  const cfg: DualHeightConfig = dualOverride ? { ...DUAL_HEIGHT_SCORING, ...dualOverride } : DUAL_HEIGHT_SCORING;
  const faceH = l.targetHeight ?? FACE_Z, handH = Math.min(faceH, HAND_Z), checkDual = faceH > HAND_Z + 1e-6;
  const enforceDual = Boolean(l.optimization?.dualHeight && checkDual);
  let redN = 0, redOk = 0, yelN = 0, yelOk = 0, weighted = 0, redMinPpm = Number.POSITIVE_INFINITY;
  let visibleCells = 0, headOnlyCells = 0, handPriorityN = 0, handPriorityOk = 0;
  const cells: Cell[] = zones.map((z) => {
    if (z.solid) return { ...z, ppm: 0, handPpm: 0, headOnly: false, dori: 'blind' as Dori };
    let facePpm = 0, handPpm = 0;
    for (const cam of l.cameras) {
      const [fp, hp] = dualPpmAt(cam, z.cx, z.cy, obstacles, faceH, checkDual ? handH : faceH, l.floorPolygon);
      if (fp > facePpm) facePpm = fp;
      if (hp > handPpm) handPpm = hp;
    }
    if (!checkDual) handPpm = facePpm;
    const band = riskBand(z.w);
    const ppm = facePpm;
    const dori = doriOf(ppm);
    const headOnly = checkDual && facePpm >= cfg.handDetectPpm && handPpm < cfg.handDetectPpm;
    if (facePpm >= DORI_MIN.detection) visibleCells++;
    if (headOnly) headOnlyCells++;
    if (z.w >= cfg.minWeightForHandCheck) {
      handPriorityN++;
      if (handPpm >= cfg.handMinPpm) handPriorityOk++;
    }
    if (band === 'red') { redN++; redMinPpm = Math.min(redMinPpm, ppm); if (ppm >= DORI_MIN.identification) redOk++; }
    else if (band === 'yellow') { yelN++; if (ppm >= DORI_MIN.recognition) yelOk++; }
    weighted += z.w * dualEffectiveFactor(z.w, facePpm, handPpm, enforceDual, cfg);
    return { ...z, ppm, handPpm, headOnly, dori };
  });
  const pct = (a: number, n: number) => (n ? Math.round((a / n) * 1000) / 10 : 100);
  return {
    cells,
    score: {
      red: pct(redOk, redN), yellow: pct(yelOk, yelN), redCells: redN, yellowCells: yelN,
      redMinPpm: Number.isFinite(redMinPpm) ? Math.round(redMinPpm) : 0,
      weighted: Math.round(weighted * 10) / 10,
      handCoverage: checkDual ? pct(handPriorityOk, handPriorityN) : undefined,
      headOnlyCells, headOnlyPct: visibleCells ? Math.round((headOnlyCells / visibleCells) * 1000) / 10 : 0,
      cams: l.cameras.length, ms: Math.round((performance.now() - t0) * 100) / 100
    }
  };
}
