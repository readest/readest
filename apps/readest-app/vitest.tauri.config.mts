import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { webdriverio } from '@vitest/browser-webdriverio';
import { loadEnvFile } from './vitest.env.mts';

// Load .env and .env.tauri so tauri tests have the same env as the desktop app.
const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.tauri'), CWD: process.cwd() };

export default defineConfig({
  plugins: [tsconfigPaths()],
  define: {
    'process.env': JSON.stringify(env),
  },
  resolve: {
    conditions: ['development'],
  },
  test: {
    include: ['src/**/*.tauri.test.ts'],
    setupFiles: ['./vitest.tauri.setup.ts'],
    testTimeout: 30000,
    browser: {
      enabled: true,
      provider: webdriverio({
        hostname: '127.0.0.1',
        port: 4445,
        capabilities: {
          browserName: 'chrome',
        } as WebdriverIO.Capabilities,
      }),
      instances: [{ browser: 'chrome' }],
    },
  },
});
