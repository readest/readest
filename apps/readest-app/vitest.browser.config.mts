import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { loadEnvFile } from './vitest.env.mts';

// Load .env and .env.web so browser tests have the same env as the web app.
const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.web') };

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
      'js-md5',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/api/path',
      '@tauri-apps/api/core',
      '@zip.js/zip.js',
      'franc-min',
      'iso-639-2',
      'iso-639-3',
      'uuid',
      'jwt-decode',
      '@supabase/supabase-js',
    ],
    exclude: [
      '@tursodatabase/database-wasm',
      '@tursodatabase/database-wasm-common',
      '@tursodatabase/database-common',
    ],
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  test: {
    include: ['src/**/*.browser.test.ts'],
    onConsoleLog(log, type) {
      if (type === 'stdout') return false;
    },
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
