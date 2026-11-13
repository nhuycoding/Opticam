export type ViewMode = 'dori' | 'risk' | 'off';
export type Tool = 'select' | 'measure' | 'person';
export type Selection = { kind: 'cam' | 'obs' | 'person'; id: string } | null;
export type Segment = { a: [number, number]; b: [number, number] } | null; // mét
export type PriorityBand = 'low' | 'medium' | 'high';

export const PAD = 58;      // lề Stage (px)
export const HANDLE = 40;   // khoảng cách tay cầm xoay (px)
export const DORI_COLOR: Record<string, string> = {
  identification: 'rgba(22,163,74,.3)', recognition: 'rgba(132,204,22,.28)', observation: 'rgba(250,204,21,.28)',
  detection: 'rgba(249,115,22,.3)', blind: 'rgba(220,38,38,.28)'
};
const RISK_STOPS = [
  { weight: 1, color: [134, 164, 170, 0.025] },
  { weight: 2, color: [230, 177, 75, 0.18] },
  { weight: 3, color: [241, 150, 65, 0.3] },
  { weight: 4, color: [244, 112, 75, 0.44] },
  { weight: 5, color: [238, 78, 82, 0.58] }
] as const;

export const priorityBand = (weight: number): PriorityBand => weight < 2 ? 'low' : weight < 4 ? 'medium' : 'high';
export const shouldShowRiskWeight = (weight: number, gridM: number): boolean =>
  gridM >= 0.5 && (gridM === 0.5 || weight >= 2);
export const priorityColor = (weight: number): string => weight >= 4 ? '#ee625d' : weight >= 2 ? '#e9ad49' : '#91a5a8';

export function riskColor(weight: number): string {
  const w = Math.max(1, Math.min(5, weight));
  const upperIndex = RISK_STOPS.findIndex((stop) => stop.weight >= w);
  const upper = RISK_STOPS[Math.max(1, upperIndex)];
  const lower = RISK_STOPS[Math.max(0, upperIndex - 1)];
  const t = (w - lower.weight) / (upper.weight - lower.weight);
  const channels = lower.color.map((channel, index) => channel + (upper.color[index] - channel) * t);
  const [red, green, blue, alpha] = channels;
  return `rgba(${Math.round(red)},${Math.round(green)},${Math.round(blue)},${alpha.toFixed(3)})`;
}
export const OBS_FILL = {
  pos: '#d6c4a5',
  entrance: '#f7f7ef',
  shelf: '#e4e5db'
} as const;

/** Gộp cập nhật state theo requestAnimationFrame khi kéo thả (giữ 60 FPS khi nhiều camera). */
let raf = 0;
export const scheduleFrame = (fn: () => void) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };

/** Deterministic label placement shared by drawing and heatmap text masking. */
export function cameraLabelBoxes(cameras: { id: string; x: number; y: number }[], roomW: number, roomH: number, ppm: number, labelScale = 1) {
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  return cameras.map(camera => {
    const width = Math.min(116 * labelScale, Math.max(54, roomW * ppm - 16)), height = Math.min(36 * labelScale, roomH * ppm - 16);
    const cx = camera.x * ppm, cy = camera.y * ppm;
    const x = Math.max(8, Math.min(cx < roomW * ppm / 2 ? cx + 18 * labelScale : cx - width - 18 * labelScale, roomW * ppm - width - 8));
    const baseY = cy < roomH * ppm / 2 ? cy + 26 * labelScale : cy - height - 20 * labelScale;
    let y = Math.max(8, Math.min(baseY, roomH * ppm - height - 8));
    for (let attempt = 0; attempt < cameras.length; attempt++) {
      if (!placed.some(box => x < box.x + box.width + 4 && x + width + 4 > box.x && y < box.y + box.height + 4 && y + height + 4 > box.y)) break;
      y = cy < roomH * ppm / 2 ? y + height + 5 : y - height - 5;
      if (y < 8 || y + height > roomH * ppm - 8) { y = Math.max(8, Math.min(baseY, roomH * ppm - height - 8)); break; }
    }
    const box = { x, y, width, height }; placed.push(box); return box;
  });
}
