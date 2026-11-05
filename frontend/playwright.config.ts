import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `${python} -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`,
      cwd: '..',
      url: 'http://127.0.0.1:8000/api/v1/health',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});
