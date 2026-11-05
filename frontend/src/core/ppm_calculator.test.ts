import { describe, expect, it } from 'vitest';
import {
  calculateDoriAtDistance,
  calculateDoriDistances,
  calculateFov,
  calculatePpm,
  classifyDori,
  type OpticalSpec,
} from './ppm_calculator';

const camera: OpticalSpec = {
  sensorWidthMm: 5.37,
  sensorHeightMm: 3.02,
  focalLengthMm: 2.8,
  resolutionWidthPx: 1920,
};

describe('sensor-based optical calculator', () => {
  it('calculates FOV for a 1/2.8-inch 16:9 active sensor and 2.8 mm lens', () => {
    const fov = calculateFov(camera);
    expect(fov.horizontalDeg).toBeCloseTo(87.6, 1);
    expect(fov.verticalDeg).toBeCloseTo(56.7, 1);
    expect(fov.diagonalDeg).toBeCloseTo(95.5, 1);
  });

  it('calculates horizontal PPM from sensor width, focal length, and target distance', () => {
    expect(calculatePpm(camera, 10)).toBeCloseTo(100.1, 1);
    expect(calculateDoriAtDistance(camera, 10)).toEqual({
      ppm: expect.closeTo(100.1, 1),
      dori: 'observation',
    });
  });

  it('calculates the maximum distance for all four DORI thresholds', () => {
    const distances = calculateDoriDistances(camera);
    expect(distances.identification).toBeCloseTo(4.00, 2);
    expect(distances.recognition).toBeCloseTo(8.01, 2);
    expect(distances.observation).toBeCloseTo(16.15, 2);
    expect(distances.detection).toBeCloseTo(40.04, 2);
  });

  it('covers a 1/1.8-inch 4 MP sensor with a 4 mm lens', () => {
    const spec: OpticalSpec = {
      sensorWidthMm: 7.2,
      sensorHeightMm: 4.05,
      focalLengthMm: 4,
      resolutionWidthPx: 2688,
    };
    expect(calculateFov(spec).horizontalDeg).toBeCloseTo(83.97, 2);
    expect(calculatePpm(spec, 12)).toBeCloseTo(124.44, 2);
    expect(calculateDoriAtDistance(spec, 12).dori).toBe('observation');
  });

  it('covers an 8 MP 1/2.8-inch sensor with a 6 mm lens at DORI boundaries', () => {
    const spec: OpticalSpec = { ...camera, focalLengthMm: 6, resolutionWidthPx: 3840 };
    const limits = calculateDoriDistances(spec);
    expect(calculateFov(spec).horizontalDeg).toBeCloseTo(48.2, 1);
    expect(calculatePpm(spec, limits.identification)).toBeCloseTo(250, 8);
    expect(calculatePpm(spec, limits.detection)).toBeCloseTo(25, 8);
    expect(calculateDoriAtDistance(spec, limits.identification).dori).toBe('identification');
    expect(calculateDoriAtDistance(spec, limits.identification * 1.01).dori).toBe('recognition');
  });

  it('classifies exact threshold boundaries into the corresponding DORI tier', () => {
    expect(classifyDori(250)).toBe('identification');
    expect(classifyDori(125)).toBe('recognition');
    expect(classifyDori(62)).toBe('observation');
    expect(classifyDori(25)).toBe('detection');
    expect(classifyDori(24.99)).toBe('blind');
  });

  it('rejects invalid optical inputs and target distances', () => {
    expect(() => calculateFov({ ...camera, focalLengthMm: 0 })).toThrow(RangeError);
    expect(() => calculatePpm(camera, 0)).toThrow(RangeError);
    expect(() => classifyDori(Number.NaN)).toThrow(RangeError);
  });
});
