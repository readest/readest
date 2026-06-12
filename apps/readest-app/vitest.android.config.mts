import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Android device lane: drives the installed Readest app on an adb-connected
// device or emulator through the WebView's Chrome DevTools Protocol plus adb
// input gestures. Tests run on the host in a plain node environment — the
// "browser" under test is the app itself.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.android.test.ts'],
    // One device, one app instance: never parallelize.
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: { concurrent: false },
    // Real gestures + page turns are slow; native gestures can be flaky once.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 1,
  },
});
