export const CAMERA_QUALITY_PRESETS = [
  { id: '2mp', label: '2 MP · 1920 × 1080', resolution: 1920, model: 'OptiCam IP 2MP 1080p' },
  { id: '4mp', label: '4 MP · 2560 × 1440', resolution: 2560, model: 'OptiCam IP 4MP 1440p' },
  { id: '8mp', label: '8 MP · 3840 × 2160', resolution: 3840, model: 'OptiCam IP 8MP 4K' }
] as const;

export type CameraQualityId = (typeof CAMERA_QUALITY_PRESETS)[number]['id'] | 'custom';

export const cameraQualityForResolution = (resolution: number): CameraQualityId =>
  CAMERA_QUALITY_PRESETS.find((preset) => preset.resolution === resolution)?.id ?? 'custom';
import type { Camera, Layout } from '../types';

export const cameraNumber = (index: number) => String(index + 1).padStart(2, '0');

export const DEFAULT_CAMERA_TILT = 20;
export const DEFAULT_CEILING_HEIGHT = 3.2;
export const DEFAULT_CEILING_DROP = 0.15;
export const cameraMount = (camera: Camera): 'wall' | 'ceiling' => camera.mount === 'ceiling' ? 'ceiling' : 'wall';
export function ceilingHeightFor(layout: Pick<Layout, 'ceilingHeight'>): number {
  return Number.isFinite(layout.ceilingHeight) ? Math.min(6, Math.max(2.4, layout.ceilingHeight!)) : DEFAULT_CEILING_HEIGHT;
}
export function ceilingCameraHeight(layout: Pick<Layout, 'ceilingHeight'>, drop = DEFAULT_CEILING_DROP): number {
  const ceiling = ceilingHeightFor(layout);
  const distance = Number.isFinite(drop) ? Math.min(1, ceiling - 1.8, Math.max(0.15, drop)) : DEFAULT_CEILING_DROP;
  return Math.round((ceiling - distance) * 1e6) / 1e6;
}
/** Keep the saved lens elevation consistent with its mounting surface. */
export function normalizeCameraPlacement(camera: Camera, layout: Pick<Layout, 'ceilingHeight'>): Camera {
  const ceiling = ceilingHeightFor(layout);
  if (cameraMount(camera) === 'ceiling') {
    const height = ceilingCameraHeight(layout, camera.ceilingDrop);
    return { ...camera, height, ceilingDrop: Math.round((ceiling - height) * 1e6) / 1e6 };
  }
  return { ...camera, height: Math.min(Math.round((ceiling - 0.3) * 1e6) / 1e6, Math.max(1.8, Number.isFinite(camera.height) ? camera.height : 2.4)) };
}
export const verticalFovFor = (horizontalFov: number) =>
  2 * Math.atan(Math.tan(horizontalFov * Math.PI / 360) / (16 / 9)) * 180 / Math.PI;

/** Thông số xem phối cảnh. Các dự án cũ dùng cảm biến 16:9 và góc chúc 20°. */
export function cameraProjection(camera: Camera) {
  const vfov = camera.vfov ?? verticalFovFor(camera.fov);
  return {
    tilt: Math.min(90, Math.max(0, camera.tilt ?? (cameraMount(camera) === 'ceiling' ? 45 : DEFAULT_CAMERA_TILT))),
    vfov,
    aspect: Math.tan(camera.fov * Math.PI / 360) / Math.tan(vfov * Math.PI / 360)
  };
}

