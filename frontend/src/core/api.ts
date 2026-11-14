import { pointInFloor } from './footprint';
import type { Camera, Layout, Zone } from '../types';
import { normalizeCameras } from './io';
import { solveLocally } from './localSolver';

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
    cameraProfiles: cameraProfiles?.map(({ fov, res, range, height, model, tilt, vfov }) => ({ fov, res, range, height, model, tilt, vfov })),
    layout: { version: l.version, name: l.name, widthM: l.widthM, heightM: l.heightM, gridM: l.gridM, targetHeight: l.targetHeight, floorPolygon: l.floorPolygon, obstacles: l.obstacles },
    grid: { rows, cols, cellSizeM: l.gridM },
    riskMatrix,      // [row][col] ∈ [1, 5], continuous weights including manual strokes
    blockedMatrix    // [row][col] ∈ {0, 1}     (1 = ô bị kệ/POS chiếm)
  };
}

export function fromApiResponse(json: any, l: Layout): Camera[] {
  const list = json?.cameras ?? json?.data?.cameras;
  const cams = normalizeCameras(list, l.widthM, l.heightM);
  if (l.floorPolygon && cams.some(camera => !pointInFloor([camera.x, camera.y], l.floorPolygon!))) throw new Error('Camera nằm ngoài đường bao.');
  if (!cams.length) throw new Error('Backend không trả về camera nào.');
  return cams;
}

/** POST /api/v1/optimize; quá 1.5 s hoặc lỗi → Greedy phía client. */
export async function requestOptimize(l: Layout, zones: Zone[], K = 3, cameraProfiles?: Camera[], signal?: AbortSignal): Promise<{ cameras: Camera[]; source: 'api' | 'client' }> {
  if (signal?.aborted) throw new DOMException('Đã hủy tối ưu.', 'AbortError');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 1500);
  const abort = () => ctl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const res = await fetch('/api/v1/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify(toApiPayload(l, zones, K, cameraProfiles))
    });
    if (res.ok) {
      const cameras = fromApiResponse(await res.json(), l);
      if (cameras.length > K) throw new Error('Backend trả quá ngân sách camera.');
      return { cameras, source: 'api' };
    }
  } catch { /* Backend unavailable or invalid response. */ } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  const result = await solveLocally({ layout: l, zones, count: K, profiles: cameraProfiles ?? [], mode: 'positions' }, signal);
  return { cameras: result.cameras, source: 'client' };
}
