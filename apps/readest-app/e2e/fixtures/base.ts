import { test as base, expect } from '@playwright/test';

/**
 * Base test fixture for the web e2e lane.
 *
 * Overrides the `page` fixture to suppress the demo-book auto-import that
 * `useDemoBooks` performs on a fresh web session (see
 * `src/app/library/hooks/useDemoBooks.ts`). Without this, every test would
 * start with remote-fetched demo books instead of a deterministic empty
 * library — and would depend on network access at startup.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('demoBooksFetched', 'true');
      } catch {
        // localStorage may be unavailable in some contexts; ignore.
      }
    });
    await use(page);
  },
});

export { expect };
