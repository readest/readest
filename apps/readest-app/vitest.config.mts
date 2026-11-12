import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

const prebundled = [
  '@testing-library/react',
  'react-dom',
  'react-dom/client',
  'zod',
  'iso-639-3',
  'iso-639-2',
  'franc-min',
  'react-icons/md',
  'react-icons/pi',
  'react-icons/ri',
  '@supabase/supabase-js',
  'react-i18next',
  'i18next',
  'i18next-browser-languagedetector',
];

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // The @pdfjs alias from tsconfig only resolves within the app's own
      // source files.  foliate-js/pdf.js lives outside that scope, so Vite
      // needs an explicit alias to reach pdfjs-dist. It points at the real
      // package rather than a copy under `public/`: a module the bundler
      // imports must not be published too, or Tauri embeds it twice (#6368).
      '@pdfjs': path.resolve(__dirname, '../../packages/foliate-js/node_modules/pdfjs-dist/legacy/build'),
      // `js-mdict` is consumed via tsconfig paths from `packages/js-mdict/src/`.
      // Its sources `import 'fflate'` directly — without an alias, vite's
      // import-analysis walks up from the redirected file location and fails
      // to find fflate (it's installed only in this app's node_modules).
      // Pin all `fflate` resolutions to the app's copy to keep js-mdict
      // self-contained at the source-tree level.
      fflate: path.resolve(__dirname, 'node_modules/fflate'),
    },
  },
  test: {
    // Match PR CI's budget: more workers can push CPU-heavy tests past 5s
    // on shared machines (#7239). Override with --maxWorkers when needed.
    maxWorkers: 4,
    // Worker threads start a test file faster than forked processes: the
    // full suite ran in 296 s against 324 s with forks.
    pool: 'threads',
    environment: 'jsdom',
    silent: 'passed-only',
    // Bundle the heaviest dependencies once rather than loading their files
    // in every test file (imports took 170 s instead of 197 s in a full run).
    // Leave out a package whose subpaths register into it: dayjs locales
    // imported as dayjs/locale/* would register into another dayjs copy.
    deps: {
      optimizer: {
        client: { enabled: true, include: prebundled },
        ssr: { enabled: true, include: prebundled },
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      // Playwright web e2e specs — run via `pnpm test:e2e:web`, not vitest.
      '**/e2e/**',
      '**/*.browser.test.ts',
      '**/*.browser.test.tsx',
      '**/*.tauri.test.ts',
      // Android device e2e — run via `pnpm test:android`, not the unit lane.
      '**/*.android.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/test/**',
      ],
    },
  },
});
