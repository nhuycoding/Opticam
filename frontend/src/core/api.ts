import { pointInFloor } from './footprint';
import type { Camera, Layout, Zone } from '../types';
import { normalizeCameras } from './io';
import { solveLocally } from './localSolver';
import type { OptimizationDiagnostics } from './optimizer';

/**
 * ĐIỂM DUY NHẤT cần sửa khi chốt schema với Gia Bảo (xem docs/API_CONTRACT.md):
 *   toApiPayload()     — Canvas → Backend (toạ độ vật cản + ma trận rủi ro)
 *   fromApiResponse()  — Backend → Canvas (danh sách camera gợi ý)
 */
export function toApiPayload(l: Layout, zones: Zone[], cameraBudgetK: number, cameraProfiles?: Camera[]) {
  const cols = Math.round(l.widthM / l.gridM), rows = Math.round(l.heightM / l.gridM);
  const riskMatrix = Array.from({ length: rows }, (_, r) => zones.slice(r * cols, (r + 1) * cols).map((z) => z.w));
  const blockedMatrix = Array.from({ length: rows }, (_, r) => zones.slice(r * cols, (r + 1) * cols).map((z) => (z.solid ? 1 : 0)));
  return {
    cameraBudgetK,
    cameraProfiles: cameraProfiles?.map(({ fov, res, range, height, model, tilt, vfov, ceilingDrop }) => ({ fov, res, range, height, model, tilt, vfov, ceilingDrop })),
    layout: { version: l.version, name: l.name, widthM: l.widthM, heightM: l.heightM, gridM: l.gridM, targetHeight: l.targetHeight, ceilingHeight: l.ceilingHeight, optimization: l.optimization, floorPolygon: l.floorPolygon, obstacles: l.obstacles },
    grid: { rows, cols, cellSizeM: l.gridM },
    riskMatrix,      // [row][col] ∈ [1, 5], continuous weights including manual strokes
    blockedMatrix    // [row][col] ∈ {0, 1}     (1 = ô bị kệ/POS chiếm)
  };
}

export function fromApiResponse(json: any, l: Layout): Camera[] {
  const list = json?.cameras ?? json?.data?.cameras;
  const cams = normalizeCameras(list, l.widthM, l.heightM, l);
  if (l.floorPolygon && cams.some(camera => !pointInFloor([camera.x, camera.y], l.floorPolygon!))) throw new Error('Camera nằm ngoài đường bao.');
  if (!cams.length) throw new Error('Backend không trả về camera nào.');
  return cams;
}

function readDiagnostics(value: any): OptimizationDiagnostics | undefined {
  if (!value || !['greedy', 'hybrid', 'kpi_hybrid'].includes(value.algorithm)) return;
  const keys = ['greedyScore', 'finalScore', 'iterations', 'candidateCount', 'ms'] as const;
  if (!keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)) return;
  if (!Number.isInteger(value.iterations) || !Number.isInteger(value.candidateCount)) return;
  if (value.greedyScore > 0 && value.finalScore <= 0) return;
  if (value.algorithm !== 'kpi_hybrid' && value.finalScore < value.greedyScore - 1e-6) return;
  if (value.algorithm === 'greedy' && Math.abs(value.finalScore - value.greedyScore) > 1e-6) return;
  return { algorithm: value.algorithm, greedyScore: value.greedyScore, finalScore: value.finalScore,
    iterations: value.iterations, candidateCount: value.candidateCount, ms: value.ms };
}

/** POST /api/v1/optimize; timeout/error falls back to the same bounded solver in a Worker. */
export async function requestOptimize(l: Layout, zones: Zone[], K = 3, cameraProfiles?: Camera[], signal?: AbortSignal): Promise<{ cameras: Camera[]; source: 'api' | 'client'; diagnostics?: OptimizationDiagnostics }> {
  if (signal?.aborted) throw new DOMException('Đã hủy tối ưu.', 'AbortError');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  const abort = () => ctl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const res = await fetch('/api/v1/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify(toApiPayload(l, zones, K, cameraProfiles))
    });
    if (res.ok) {
      const json = await res.json();
      const cameras = fromApiResponse(json, l);
      if (cameras.length > K) throw new Error('Backend trả quá ngân sách camera.');
      const diagnostics = readDiagnostics(json.diagnostics);
      if (!diagnostics || diagnostics.algorithm !== (l.optimization?.algorithm ?? 'kpi_hybrid') || diagnostics.candidateCount < cameras.length) throw new Error('Backend cần cập nhật bộ tối ưu camera trần.');
      const mounts = l.optimization?.mounts ?? 'mixed';
      if (mounts !== 'mixed' && cameras.some(camera => (camera.mount ?? 'wall') !== mounts)) throw new Error('Backend trả sai kiểu lắp camera.');
      return { cameras, source: 'api', diagnostics };
    }
  } catch { /* Backend unavailable or invalid response. */ } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  const result = await solveLocally({ layout: l, zones, count: K, profiles: cameraProfiles ?? [], mode: 'positions' }, signal);
  return { cameras: result.cameras, source: 'client', diagnostics: result.diagnostics };
}
