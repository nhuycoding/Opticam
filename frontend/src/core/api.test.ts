import { afterEach, describe, expect, it, vi } from 'vitest';
import { withManualCams, PRESETS } from '../data/presets';
import { buildZones } from './optics';
import { requestOptimize } from './api';
import { solveLocally } from './localSolver';

vi.mock('./localSolver', () => ({ solveLocally: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const layout = withManualCams(PRESETS[0]);
const zones = buildZones(layout);
const localResult = { cameras: layout.cameras.slice(0, 2), metTargets: false, red: 0, yellow: 0 };

describe('Optimizer API resilience', () => {
  it('uses a valid API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ cameras: layout.cameras.slice(0, 2) }))));
    const result = await requestOptimize(layout, zones, 2);
    expect(result.source).toBe('api');
    expect(result.cameras).toHaveLength(2);
    expect(solveLocally).not.toHaveBeenCalled();
  });
  it.each(['network', 'http', 'invalid', 'over-budget'])('falls back after %s failure', async (failure) => {
    const fetch = failure === 'network'
      ? vi.fn().mockRejectedValue(new TypeError('offline'))
      : vi.fn().mockResolvedValue(new Response(JSON.stringify(failure === 'invalid' ? { cameras: [null] } : { cameras: layout.cameras }), { status: failure === 'http' ? 503 : 200 }));
    vi.stubGlobal('fetch', fetch);
    vi.mocked(solveLocally).mockResolvedValue(localResult);
    const result = await requestOptimize(layout, zones, 2);
    expect(result.source).toBe('client');
    expect(result.cameras).toHaveLength(2);
  });
  it('does not start a request after cancellation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(requestOptimize(layout, zones, 2, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(solveLocally).not.toHaveBeenCalled();
  });
  it('propagates cancellation to fetch and the local solver', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    vi.mocked(solveLocally).mockImplementation((_request, signal) => {
      expect(signal?.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    const result = requestOptimize(layout, zones, 2, undefined, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
