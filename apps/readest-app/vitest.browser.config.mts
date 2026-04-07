import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { loadEnvFile } from './vitest.env.mts';

// Load .env and .env.web so browser tests have the same env as the web app.
const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.web') };

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
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
      '@testing-library/react',
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
    include: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
    onConsoleLog(_log, type) {
      if (type === 'stdout') return false;
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: {
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 2,
        },
      }),
      instances: [{ browser: 'chromium' }],
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0.1,
            allowedMismatchedPixelRatio: 0.02,
          },
          // Strip platform from the path so one baseline works on macOS and Linux.
          // The path is relative to the project root (not the test file).
          resolveScreenshotPath: ({ arg, browserName, ext, testFileDirectory, testFileName }) =>
            `${testFileDirectory}/__screenshots__/${testFileName}/${arg}-${browserName}${ext}`,
        },
      },
    },
  },
});
