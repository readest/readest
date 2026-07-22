import { expect, test } from '../fixtures/base';
import { LibraryPage } from '../pages/LibraryPage';

test.describe('Library page', () => {
  test('renders the library shell and an empty-library state', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    await expect(library.container).toBeVisible();
    await expect(library.header).toBeVisible();
    await expect(library.emptyState).toBeVisible();
  });

  test('opens the import options from the empty-library state', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();

    await library.emptyStateImportButton.click();

    await expect(library.importDialog).toBeVisible();
    await expect(library.localFileImportButton).toBeVisible();
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
});
