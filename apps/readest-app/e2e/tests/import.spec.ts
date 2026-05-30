import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB, SAMPLE_TXT } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.describe('Book import', () => {
  test('imports a plain-text file and surfaces it in the bookshelf', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.importBook(SAMPLE_TXT);

    await expect(library.bookshelf).toBeVisible();
    await expect(library.bookCards()).toHaveCount(1);
  });

  test('imports an EPUB file and surfaces it in the bookshelf', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.importBook(SAMPLE_EPUB);

    await expect(library.bookshelf).toBeVisible();
    await expect(library.bookCards()).toHaveCount(1);
  });
});
