import type { Layout } from '../types';
import { buildBom } from './bom';
import { toApiPayload } from './api';
import { satCollide, rectPoly, snapAngle } from './geometry';
import { exportBundle, parseBundle } from './io';
import { buildZones, evaluate } from './optics';
import {
  calculateDoriAtDistance,
  calculateFov,
  calculatePpm,
  type OpticalSpec,
} from './ppm_calculator';

export type UiTestStatus = 'passed' | 'failed';
export type UiTestGroup = 'frontend' | 'integration';

export interface UiTestResult {
  id: string;
  name: string;
  group: UiTestGroup;
  status: UiTestStatus;
  durationMs: number;
  details: string;
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

async function recordCheck(
  id: string,
  name: string,
  group: UiTestGroup,
  check: () => void | Promise<void>,
): Promise<UiTestResult> {
  const started = performance.now();
  try {
    await check();
    return {
      id, name, group, status: 'passed',
      durationMs: performance.now() - started,
      details: 'Đạt',
    };
  } catch (error) {
    return {
      id, name, group, status: 'failed',
      durationMs: performance.now() - started,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

const SENSOR: OpticalSpec = {
  sensorWidthMm: 5.37,
  sensorHeightMm: 3.02,
  focalLengthMm: 2.8,
  resolutionWidthPx: 1920,
};

export async function runFrontendUiTests(layout: Layout): Promise<UiTestResult[]> {
  const checks: Array<[string, string, () => void]> = [
    ['optics', 'FOV và PPM cảm biến', () => {
      const fov = calculateFov(SENSOR);
      assert(Math.abs(fov.horizontalDeg - 87.6) < 0.1, `FOV ngang lệch: ${fov.horizontalDeg.toFixed(2)}°`);
      assert(Math.abs(calculatePpm(SENSOR, 10) - 100.1) < 0.2, 'PPM tại 10 m không khớp');
    }],
    ['dori', 'Phân lớp DORI tại ngưỡng', () => {
      assert(calculateDoriAtDistance(SENSOR, 10).dori === 'observation', 'Mức DORI tại 10 m không phải Observation');
      assert(calculateDoriAtDistance(SENSOR, 4).dori === 'identification', 'Mốc Identification không chính xác');
    }],
    ['geometry', 'Hình học và góc pan', () => {
      assert(snapAngle(22) === 15 && snapAngle(-10) === 345, 'Snap góc 15° không đúng');
      assert(satCollide(rectPoly(0, 0, 2, 2, 0), rectPoly(1, 0, 2, 2, 0)), 'Không phát hiện vùng chồng hình chữ nhật');
      assert(!satCollide(rectPoly(0, 0, 1, 1, 0), rectPoly(2, 0, 1, 1, 0)), 'Báo va chạm sai với hình tách rời');
    }],
    ['layout-roundtrip', 'Export/import giữ layout và camera', () => {
      const restored = parseBundle(exportBundle(layout, evaluate(layout, buildZones(layout)).score));
      assert(restored.widthM === layout.widthM && restored.heightM === layout.heightM, 'Kích thước layout bị thay đổi');
      assert(restored.cameras.length === layout.cameras.length, 'Số camera sau import không khớp');
      assert(restored.cameras.every((camera, i) => camera.id === layout.cameras[i].id && camera.x === layout.cameras[i].x && camera.y === layout.cameras[i].y), 'Tọa độ camera sau import không khớp');
    }],
    ['bom', 'BOM cáp và nguồn PoE', () => {
      const bom = buildBom(layout);
      assert(bom.totalCameras === layout.cameras.length, 'Số camera trong BOM không khớp layout');
      assert(bom.totalCableM === bom.rows.reduce((sum, row) => sum + row.cableM, 0), 'Tổng chiều dài cáp không khớp các dòng');
      assert(bom.totalCameraPowerW === Math.round(bom.rows.reduce((sum, row) => sum + row.powerW, 0) * 10) / 10, 'Tổng công suất không khớp các dòng');
      assert(bom.recommendedPoeBudgetW >= bom.totalCameraPowerW * 1.2, 'Ngân sách PoE chưa đủ dự phòng 20%');
    }],
    ['heatmap', 'Heatmap và scorecard layout hiện tại', () => {
      const zones = buildZones(layout);
      const { cells, score } = evaluate(layout, zones);
      assert(cells.length === zones.length && cells.every((cell) => Number.isFinite(cell.ppm) && cell.ppm >= 0), 'Heatmap có số ô hoặc PPM không hợp lệ');
      assert(Number.isFinite(score.weighted) && score.cams === layout.cameras.length, 'Scorecard không hợp lệ');
    }],
  ];

  return Promise.all(checks.map(([id, name, check]) =>
    recordCheck(id, name, 'frontend', check)));
}

export async function runIntegrationUiTests(layout: Layout): Promise<UiTestResult[]> {
  const healthCheck = recordCheck('api-health', 'Backend API health', 'integration', async () => {
    const response = await fetch('/api/v1/health', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Backend trả HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}. ` +
        'Kiểm tra backend tại http://127.0.0.1:8000/api/v1/health và khởi động lại Vite sau khi đổi cấu hình proxy.',
      );
    }
    const health = await response.json() as { status?: string };
    assert(health.status === 'ok', 'Backend không trả status=ok');
  });

  const optimizeCheck = recordCheck('api-optimize', 'Gửi layout và nhận kết quả Greedy', 'integration', async () => {
    const zones = buildZones(layout);
    const response = await fetch('/api/v1/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApiPayload(layout, zones, 3)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Optimize API trả HTTP ${response.status}: ${errorBody.slice(0, 300)}. ` +
        'Kiểm tra backend tại http://127.0.0.1:8000/docs.',
      );
    }
    const result = await response.json() as {
      cameras?: Array<{ x?: number; y?: number; pan?: number }>;
      metrics?: { area_coverage_pct?: number; weighted_coverage_pct?: number };
    };
    const cameras = result.cameras;
    if (!Array.isArray(cameras) || cameras.length === 0) throw new Error('API không trả camera đề xuất');
    assert(cameras.length <= 3, 'API trả vượt ngân sách 3 camera');
    assert(cameras.every((camera) => Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.pan)), 'Camera trả về có tọa độ hoặc pan không hợp lệ');
    assert(Number.isFinite(result.metrics?.area_coverage_pct), 'Thiếu metric area_coverage_pct');
    assert(Number.isFinite(result.metrics?.weighted_coverage_pct), 'Thiếu metric weighted_coverage_pct');
  });

  return Promise.all([healthCheck, optimizeCheck]);
}
