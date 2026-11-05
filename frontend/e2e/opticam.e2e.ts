import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const sourceLayout = {
  version: '1.0',
  name: 'E2E Integration Layout',
  widthM: 4,
  heightM: 3,
  gridM: 1,
  pixelsPerMeter: 68,
  obstacles: [],
  risk: {},
  cameras: [
    {
      id: 'CAM-SOURCE',
      x: 0,
      y: 1.5,
      pan: 0,
      fov: 85,
      res: 2560,
      range: 10,
      height: 2.4,
      powerW: 18,
    },
  ],
};

test('imports, optimizes, renders DORI, exports BOM and round-trips project JSON', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[accept=".json"]').setInputFiles({
    name: 'e2e-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sourceLayout)),
  });

  await expect(page.locator('header')).toContainText('E2E Integration Layout');
  await expect(page.getByText('≥250 PPM', { exact: true })).toBeVisible();

  const optimizeResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/optimize') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Auto-Optimize (3 Cameras)' }).click();
  const response = await optimizeResponse;
  expect(response.ok()).toBe(true);
  const optimizeResult = await response.json();
  expect(optimizeResult.metrics.area_coverage_pct).toBeGreaterThan(85);
  await expect(page.locator('.toast')).toContainText('Backend API');

  await page.getByRole('button', { name: 'Bảng BOM' }).click();
  await expect(page.getByRole('heading', { name: 'Bảng dự toán vật tư & lắp đặt (BOM)' })).toBeVisible();
  await expect(page.getByText(/tải camera/)).toBeVisible();
  await expect(page.getByText(/đã dự phòng 20%/)).toBeVisible();
  const bomRows = page.locator('.modal-box table tbody tr');
  await expect(bomRows).toHaveCount(optimizeResult.cameras.length);

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải CSV' }).click(),
  ]);
  const csv = await readFile(await csvDownload.path(), 'utf8');
  expect(csv).toContain('Cong suat (W)');
  expect(csv).toContain('Ngan sach PoE de xuat (W)');
  expect(csv).toContain('"12"');
  await page.getByRole('button', { name: 'Đóng' }).click();

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  const exportedText = await readFile(await jsonDownload.path(), 'utf8');
  const bundle = JSON.parse(exportedText);
  expect(bundle.format).toBe('opticam-bundle');
  expect(bundle.layout.name).toBe('E2E Integration Layout');
  expect(bundle.layout.cameras).toHaveLength(optimizeResult.cameras.length);
  expect(bundle.bom.recommendedPoeBudgetW).toBeGreaterThan(0);

  await page.locator('input[accept=".json"]').setInputFiles({
    name: 'round-trip.opticam.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.locator('header')).toContainText('E2E Integration Layout');
  await expect(page.locator('header')).toContainText('4×3 m');
});

test('runs the 20-camera drawing benchmark', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Benchmark 20 cam' }).click();
  await expect(page.locator('.toast')).toContainText(/20 camera × 120 khung: \d+ FPS TB · p95 \d+\.\d+ ms/);
});

test('shows frontend and live API test results in the test tab', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Kiểm thử' }).click();

  await page.getByRole('button', { name: 'Chạy test frontend' }).click();
  await expect(page.locator('.test-summary')).toContainText('6/6 đạt');
  await expect(page.locator('.test-results tbody tr')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Test tích hợp API' })).toBeEnabled();

  await page.getByRole('button', { name: 'Test tích hợp API' }).click();
  await expect(page.locator('.test-summary')).toContainText('2/2 đạt', { timeout: 20_000 });
  await expect(page.locator('.test-results tbody tr')).toHaveCount(2);
  await expect(page.locator('.test-results')).toContainText('Backend API health');
  await expect(page.locator('.test-results')).toContainText('Gửi layout và nhận kết quả Greedy');
});

test('explains how to recover from an unavailable backend proxy', async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 502, contentType: 'text/plain', body: 'backend unavailable' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Kiểm thử' }).click();
  await page.getByRole('button', { name: 'Test tích hợp API' }).click();

  await expect(page.locator('.test-summary')).toContainText('0/2 đạt');
  await expect(page.locator('.test-results')).toContainText('Backend trả HTTP 502');
  await expect(page.locator('.test-results')).toContainText('khởi động lại Vite');
  await expect(page.locator('.test-results')).toContainText('Optimize API trả HTTP 502');
});
