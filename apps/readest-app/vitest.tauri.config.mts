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
  optimizeDeps: {
    include: [
      '@supabase/supabase-js',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/api/path',
      '@tauri-apps/api/core',
      '@zip.js/zip.js',
      'franc-min',
      'iso-639-2',
      'iso-639-3',
      'js-md5',
      'jwt-decode',
      'uuid',
    ],
    exclude: [
      '@pdfjs/pdf.min.mjs',
      '@readest/turso-database-wasm',
      '@readest/turso-database-wasm-common',
      '@readest/turso-database-common',
    ],
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
