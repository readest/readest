import { expect, test } from '../fixtures/base';
import { SAMPLE_PDF } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

test.describe('Library page', () => {
  test('renders the library shell and an empty-library state', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    await expect(library.container).toBeVisible();
    await expect(library.header).toBeVisible();
    await expect(library.emptyState).toBeVisible();
  });

  test('opens the import menu from the empty-library state', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    await library.emptyStateImportButton.click();

    await expect(library.importMenu).toBeVisible();
    await expect(library.localFileImportItem).toBeVisible();
  });

  test('search input accepts text and exposes a clear control', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    await expect(library.searchInput).toBeVisible();
    await library.searchInput.fill('a test query');
    await expect(library.searchInput).toHaveValue('a test query');

    await expect(library.clearSearchButton).toBeVisible();
    await library.clearSearchButton.click();
    await expect(library.searchInput).toHaveValue('');
  });

  test('keeps a wide fitted cover at a fixed width in list view', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_PDF);
    await expect(library.bookCards()).toHaveCount(1);
    await page.goto('/library?view=list');

    await page.getByRole('button', { name: 'View Menu' }).click();
    await page.getByRole('menuitem', { name: 'Bookshelves', exact: true }).click();
    await page.locator('[data-bookshelf-tab="default"]').click();
    const settings = page.getByRole('region', { name: 'Bookshelf settings' });
    await settings.getByRole('combobox', { name: 'Book covers' }).selectOption('fit');
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    const cover = library.bookshelf.locator('.library-list-item .bookitem-main');
    const image = cover.locator('.fit-cover-img');
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    for (const width of [1280, 1024, 390, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      await expect(cover).toHaveCSS('width', '80px');
    }
  });
});
