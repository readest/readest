import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB, SAMPLE_TXT } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.describe('Book import', () => {
  test('shows a failed book filename with its literal question mark', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.container.evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['invalid EPUB'], 'Who is there?.epub'));
      dataTransfer.items.add(new File(['another invalid EPUB'], 'Atlas.epub'));
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      );
    });

    const dialog = page.getByRole('dialog', { name: 'Failed to import 2 books' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Who is there?.epub', { exact: true })).toBeVisible();
    await expect(dialog.getByText('This book format is not supported')).toHaveCount(0);
  });

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

  test('counts and lists each skipped file in a mixed failed import', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(library.emptyState).toBeVisible();

    await library.container.evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['invalid EPUB'], 'Novel.epub'));
      dataTransfer.items.add(new File(['unsupported'], 'Notes.csv'));
      dataTransfer.items.add(new File(['unsupported'], 'Cover.gif'));
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      );
    });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Failed to import 3 books');
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    for (const filename of ['Novel.epub', 'Notes.csv', 'Cover.gif']) {
      await expect(dialog.getByText(filename, { exact: true })).toBeVisible();
    }
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
