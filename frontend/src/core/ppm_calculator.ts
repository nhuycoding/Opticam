export interface OpticalSpec {
  /** Active image sensor width in millimeters, not the nominal optical format. */
  sensorWidthMm: number;
  /** Active image sensor height in millimeters, not the nominal optical format. */
  sensorHeightMm: number;
  focalLengthMm: number;
  /** Horizontal image resolution in pixels. */
  resolutionWidthPx: number;
}

export type DoriLevel = 'identification' | 'recognition' | 'observation' | 'detection' | 'blind';

export const DORI_THRESHOLDS_PPM = {
  identification: 250,
  recognition: 125,
  observation: 62,
  detection: 25,
} as const;

export interface FieldOfView {
  horizontalDeg: number;
  verticalDeg: number;
  diagonalDeg: number;
}

export type DoriDistancesM = Record<keyof typeof DORI_THRESHOLDS_PPM, number>;

const toDegrees = (radians: number): number => radians * (180 / Math.PI);

function validateSpec(spec: OpticalSpec): void {
  const values = [spec.sensorWidthMm, spec.sensorHeightMm, spec.focalLengthMm, spec.resolutionWidthPx];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Sensor dimensions, focal length, and horizontal resolution must be positive finite values.');
  }
}

function sceneWidthM(spec: OpticalSpec, distanceM: number): number {
  validateSpec(spec);
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    throw new RangeError('Target distance must be a positive finite value in meters.');
  }
  return distanceM * (spec.sensorWidthMm / spec.focalLengthMm);
}

/** Calculate horizontal, vertical, and diagonal FOV from active sensor dimensions and focal length. */
export function calculateFov(spec: OpticalSpec): FieldOfView {
  validateSpec(spec);
  const diagonalMm = Math.hypot(spec.sensorWidthMm, spec.sensorHeightMm);
  return {
    horizontalDeg: toDegrees(2 * Math.atan(spec.sensorWidthMm / (2 * spec.focalLengthMm))),
    verticalDeg: toDegrees(2 * Math.atan(spec.sensorHeightMm / (2 * spec.focalLengthMm))),
    diagonalDeg: toDegrees(2 * Math.atan(diagonalMm / (2 * spec.focalLengthMm))),
  };
}

/** Calculate horizontal pixel density on a plane perpendicular to the optical axis. */
export function calculatePpm(spec: OpticalSpec, distanceM: number): number {
  return spec.resolutionWidthPx / sceneWidthM(spec, distanceM);
}

/** Calculate the maximum distance at which each horizontal DORI pixel-density threshold is met. */
export function calculateDoriDistances(spec: OpticalSpec): DoriDistancesM {
  validateSpec(spec);
  const pixelsPerMeterAtOneMeter = spec.resolutionWidthPx * spec.focalLengthMm / spec.sensorWidthMm;
  return {
    identification: pixelsPerMeterAtOneMeter / DORI_THRESHOLDS_PPM.identification,
    recognition: pixelsPerMeterAtOneMeter / DORI_THRESHOLDS_PPM.recognition,
    observation: pixelsPerMeterAtOneMeter / DORI_THRESHOLDS_PPM.observation,
    detection: pixelsPerMeterAtOneMeter / DORI_THRESHOLDS_PPM.detection,
  };
}

/** Classify horizontal PPM using the project's IEC 62676-4 DORI thresholds. */
export function classifyDori(ppm: number): DoriLevel {
  if (!Number.isFinite(ppm) || ppm < 0) {
    throw new RangeError('PPM must be a non-negative finite value.');
  }
  if (ppm >= DORI_THRESHOLDS_PPM.identification) return 'identification';
  if (ppm >= DORI_THRESHOLDS_PPM.recognition) return 'recognition';
  if (ppm >= DORI_THRESHOLDS_PPM.observation) return 'observation';
  if (ppm >= DORI_THRESHOLDS_PPM.detection) return 'detection';
  return 'blind';
}

/** Calculate pixel density and its corresponding DORI level at a target distance. */
export function calculateDoriAtDistance(
  spec: OpticalSpec,
  distanceM: number,
): { ppm: number; dori: DoriLevel } {
  const ppm = calculatePpm(spec, distanceM);
  return { ppm, dori: classifyDori(ppm) };
}
