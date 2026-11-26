import { defineConfig } from 'vitest/config';
import base from './vitest.browser.config.mts';

// The browser config, run in WebKit (the engine of the macOS and iOS apps)
// on the tests listed here. WebKit paginates differently from Chromium: it
// cuts anything taller than a page where it falls, where Chromium moves it
// whole. List a test here when it checks a rule only WebKit needs, so it fails
// in CI when that rule regresses; in Chromium alone it passes either way.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'src/__tests__/document/paginator-image-page-fits.browser.test.ts',
      'src/__tests__/app/user/gift-card-layout.browser.test.tsx',
      // WebKit kept drawing a replaced filter after a theme change (#7981)
      'src/__tests__/utils/dark-monochrome-filter.browser.test.ts',
    ],
    browser: { ...base.test?.browser, instances: [{ browser: 'webkit' }] },
  },
});
