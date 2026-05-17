import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';
import { ReaderPage } from '../pages/ReaderPage';

const SAMPLE_BOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/books/readest-e2e-sample.txt',
);

test.describe('Reader', () => {
  test('opens an imported book and renders the viewer', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_BOOK);
    await expect(library.bookCards()).toHaveCount(1);

    await library.openFirstBook();

    const reader = new ReaderPage(page);
    await reader.waitForReady();
    await expect(page).toHaveURL(/\/reader/);
    await expect(reader.viewer).toBeVisible();
  });

  test('turns pages and reveals the header bar', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_BOOK);
    await expect(library.bookCards()).toHaveCount(1);
    await library.openFirstBook();

    const reader = new ReaderPage(page);
    await reader.waitForReady();

    await reader.revealHeader();
    await expect(reader.headerBar).toHaveCSS('opacity', '1');

    await reader.nextPage();
    await reader.prevPage();
    await expect(reader.viewer).toBeVisible();
  });
});
