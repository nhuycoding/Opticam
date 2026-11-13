export const CAMERA_QUALITY_PRESETS = [
  { id: '2mp', label: '2 MP · 1920 × 1080', resolution: 1920, model: 'OptiCam IP 2MP 1080p' },
  { id: '4mp', label: '4 MP · 2560 × 1440', resolution: 2560, model: 'OptiCam IP 4MP 1440p' },
  { id: '8mp', label: '8 MP · 3840 × 2160', resolution: 3840, model: 'OptiCam IP 8MP 4K' }
] as const;

export type CameraQualityId = (typeof CAMERA_QUALITY_PRESETS)[number]['id'] | 'custom';

export const cameraQualityForResolution = (resolution: number): CameraQualityId =>
  CAMERA_QUALITY_PRESETS.find((preset) => preset.resolution === resolution)?.id ?? 'custom';
import type { Camera } from '../types';

export const DEFAULT_CAMERA_TILT = 20;
export const verticalFovFor = (horizontalFov: number) =>
  2 * Math.atan(Math.tan(horizontalFov * Math.PI / 360) / (16 / 9)) * 180 / Math.PI;

/** Thông số xem phối cảnh. Các dự án cũ dùng cảm biến 16:9 và góc chúc 20°. */
export function cameraProjection(camera: Camera) {
  const vfov = camera.vfov ?? verticalFovFor(camera.fov);
  return {
    tilt: camera.tilt ?? DEFAULT_CAMERA_TILT,
    vfov,
    aspect: Math.tan(camera.fov * Math.PI / 360) / Math.tan(vfov * Math.PI / 360)
  };
}

