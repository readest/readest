import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright web e2e lane.
 *
 * This suite drives the Next.js *web* build (`pnpm dev-web`) in a real browser.
 * It is complementary to — not a replacement for — the WebdriverIO suite
 * (`e2e/app.e2e.ts`, run via `pnpm test:e2e`), which drives the Tauri shell.
 *
 *   - Specs:        e2e/tests/**\/*.spec.ts
 *   - Page objects: e2e/pages
 *   - Fixtures:     e2e/fixtures
 *
 * Tests run unauthenticated against a fresh browser context, so each test
 * starts from an isolated, empty local library.
 */
const PORT = 3000;

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Always write the HTML report so `pnpm test:e2e:web:report` can open it.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev-web',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
