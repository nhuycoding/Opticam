export type ViewMode = 'dori' | 'risk' | 'off';
export type Tool = 'select' | 'measure' | 'person';
export type Selection = { kind: 'cam' | 'obs' | 'person'; id: string } | null;
export type Segment = { a: [number, number]; b: [number, number] } | null; // mét
export type PriorityBand = 'low' | 'medium' | 'high';

export const PAD = 24;      // lề Stage (px)
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
  pos: 'rgba(199,163,112,.58)',
  entrance: 'rgba(180,204,199,.58)',
  shelf: 'rgba(156,188,183,.38)'
} as const;

/** Gộp cập nhật state theo requestAnimationFrame khi kéo thả (giữ 60 FPS khi nhiều camera). */
let raf = 0;
export const scheduleFrame = (fn: () => void) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };
