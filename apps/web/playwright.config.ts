import { defineConfig } from '@playwright/test';

/**
 * Layout checks in a real browser at phone, tablet and desktop sizes (docs/mobile-plan.md, "Testing").
 * Runs against the dev servers (web and API, placeholder charts are enough); starts them if they aren't up.
 * Files are *.e2e.ts so vitest leaves them alone.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    cwd: '../..',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
