import type { Camera, Layout, Zone } from '../types';
import { evaluate } from './optics';
import { greedyPlace, minimumCamerasForTargets } from './optimizer';

export interface SolverRequest {
  layout: Layout;
  zones: Zone[];
  count: number;
  profiles: Camera[];
  mode: 'positions' | 'minimum' | 'unweighted';
}

self.onmessage = ({ data }: MessageEvent<SolverRequest>) => {
  try {
    const { layout, zones, count, profiles, mode } = data;
    if (mode === 'minimum') {
      self.postMessage({ result: minimumCamerasForTargets(layout, zones, profiles) });
      return;
    }
    const cameras = greedyPlace(layout, zones, count, mode !== 'unweighted', { cameraProfiles: profiles });
    const score = evaluate({ ...layout, cameras }, zones).score;
    self.postMessage({ result: { cameras, metTargets: score.red >= 95 && score.yellow >= 80, red: score.red, yellow: score.yellow } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Không thể tính phương án camera.' });
  }
};
