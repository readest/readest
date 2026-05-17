import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';

const SAMPLE_BOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/books/readest-e2e-sample.txt',
);

test.describe('Book import', () => {
  test('imports a local file and surfaces it in the bookshelf', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.importBook(SAMPLE_BOOK);

    await expect(library.bookshelf).toBeVisible();
    await expect(library.bookCards()).toHaveCount(1);
  });
});
