import { test as base, expect } from '@playwright/test';
import { LibraryPage } from '../pages/LibraryPage';
import { ReaderPage } from '../pages/ReaderPage';
import { SAMPLE_EPUB } from './books';

type Fixtures = {
  /**
   * Imports a book (the sample EPUB by default), opens it, and returns a
   * {@link ReaderPage} that is ready to interact with.
   */
  openBook: (filePath?: string) => Promise<ReaderPage>;
};

/**
 * Base test fixture for the web e2e lane.
 *
 * - Overrides `page` to suppress the demo-book auto-import that `useDemoBooks`
 *   performs on a fresh web session (see `src/app/library/hooks/useDemoBooks.ts`),
 *   so every test starts from a deterministic empty library.
 * - Adds the `openBook` action fixture so reading/annotation specs do not
 *   repeat the import-and-open boilerplate.
 */
export const test = base.extend<Fixtures>({
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
  openBook: async ({ page }, use) => {
    await use(async (filePath = SAMPLE_EPUB) => {
      const library = new LibraryPage(page);
      await library.goto();
      await library.importBook(filePath);
      await expect(library.bookCards()).toHaveCount(1);
      await library.openFirstBook();

      const reader = new ReaderPage(page);
      await reader.waitForReady();
      return reader;
    });
  },
});

export { expect };
