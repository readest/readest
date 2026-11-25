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

  test('copies the filenames of failed imports', async ({ page }) => {
    const library = new LibraryPage(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.container.evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['invalid EPUB'], 'Book 10.epub'));
      dataTransfer.items.add(new File(['another invalid EPUB'], 'Book 2.epub'));
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      );
    });

    const dialog = page.getByRole('dialog', { name: 'Failed to import 2 books' });
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')),
      )
      .toBe('Book 2.epub\nBook 10.epub');
    await expect(dialog).toBeVisible();
  });
});
