import { defineConfig } from '@playwright/test';

/**
 * Layout checks in a real browser at phone, tablet and desktop sizes (docs/mobile-plan.md, "Testing").
 * Runs against the dev servers (web and API, placeholder charts are enough); starts them if they aren't up.
 * Files are *.e2e.ts so vitest leaves them alone. E2E_BASE_URL points them at another running web
 * server (e.g. one proxying to an API with the stack-depth charts).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    cwd: '../..',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
