import { afterEach, describe, expect, it, vi } from 'vitest';
import { withManualCams, PRESETS } from '../data/presets';
import { buildZones } from './optics';
import { requestOptimize, toApiPayload } from './api';
import { solveLocally } from './localSolver';

vi.mock('./localSolver', () => ({ solveLocally: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const layout = withManualCams(PRESETS[0]);
const zones = buildZones(layout);
const diagnostics = { algorithm:'kpi_hybrid',greedyScore:10,finalScore:12,iterations:1,candidateCount:100,ms:5 };
const localResult = { cameras: layout.cameras.slice(0, 2), metTargets: false, red: 0, yellow: 0 };

describe('Optimizer API resilience', () => {
  it('uses a valid API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ cameras: layout.cameras.slice(0, 2), diagnostics }))));
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
  it('sends the ceiling and selected algorithm through the API and fallback', async () => {
    const project = { ...layout, ceilingHeight: 3.8, optimization: { algorithm: 'hybrid' as const, mounts: 'ceiling' as const } };
    expect(toApiPayload(project, zones, 2).layout).toMatchObject({ ceilingHeight: 3.8, optimization: project.optimization });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    vi.mocked(solveLocally).mockResolvedValue(localResult);
    await requestOptimize(project, zones, 2);
    expect(vi.mocked(solveLocally).mock.calls[0][0].layout).toMatchObject({ ceilingHeight: 3.8, optimization: project.optimization });
  });
  it('preserves ceiling mount elevation', async () => {
    const project = { ...layout, ceilingHeight: 3.8 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ cameras: [{ ...layout.cameras[0], mount: 'ceiling', ceilingDrop: .3, height: 2.4 }], diagnostics }))));
    const result = await requestOptimize(project,zones,1);
    expect(result.cameras[0]).toMatchObject({ mount:'ceiling',height:3.5,ceilingDrop:.3 });
    expect(result.diagnostics).toEqual(diagnostics);
  });
  it.each([undefined, { ...diagnostics, algorithm:'greedy' }, { ...diagnostics, finalScore:0 }, { ...diagnostics, ms:'invalid' }])('falls back from stale or malformed solver metadata %j', async (metadata) => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({cameras:layout.cameras.slice(0,2),diagnostics:metadata}))));
    vi.mocked(solveLocally).mockResolvedValue(localResult);
    expect((await requestOptimize(layout,zones,2)).source).toBe('client');
    expect(solveLocally).toHaveBeenCalledOnce();
  });
  it('falls back when a backend violates the requested mounting surface', async () => {
    const project={...layout,optimization:{algorithm:'hybrid' as const,mounts:'ceiling' as const}};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({cameras:layout.cameras.slice(0,2),diagnostics:{...diagnostics,algorithm:'hybrid'}}))));
    vi.mocked(solveLocally).mockResolvedValue(localResult);
    expect((await requestOptimize(project,zones,2)).source).toBe('client');
  });
  it('accepts kpi_hybrid diagnostics returned from backend /api/v1/optimize', async () => {
    const project = { ...layout, optimization: { algorithm: 'kpi_hybrid' as const, mounts: 'mixed' as const } };
    const kpiDiag = { algorithm: 'kpi_hybrid', greedyScore: 544.37, finalScore: 544.37, iterations: 0, candidateCount: 100, ms: 12 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ cameras: layout.cameras.slice(0, 3), diagnostics: kpiDiag }))));
    const result = await requestOptimize(project, zones, 3);
    expect(result.source).toBe('api');
    expect(result.diagnostics?.algorithm).toBe('kpi_hybrid');
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
