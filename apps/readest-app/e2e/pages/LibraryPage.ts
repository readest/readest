import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The library page (`/library`, also rendered at `/`).
 */
export class LibraryPage extends BasePage {
  readonly container: Locator;
  readonly header: Locator;
  readonly bookshelf: Locator;
  readonly searchInput: Locator;
  readonly clearSearchButton: Locator;
  readonly emptyState: Locator;
  readonly emptyStateImportButton: Locator;
  readonly importDialog: Locator;
  readonly localFileImportButton: Locator;

  constructor(page: Page) {
    super(page);
    this.container = page.locator('[aria-label="Your Library"]');
    this.header = page.locator('[aria-label="Library Header"]');
    this.bookshelf = page.locator('[aria-label="Bookshelf"]');
    this.searchInput = page.locator('.search-input');
    this.clearSearchButton = page.locator('[aria-label="Clear Search"]');
    this.emptyState = page.getByRole('heading', { name: 'Start your library' });
    this.emptyStateImportButton = page.locator('.hero').getByRole('button', {
      name: 'Import Books',
    });
    this.importDialog = page.getByRole('dialog', { name: 'Import Books' });
    this.localFileImportButton = this.importDialog.getByRole('button', {
      name: /From Local File/,
    });
  }

  async goto(): Promise<void> {
    await this.page.goto('/library');
    await this.container.waitFor({ state: 'visible' });
  }

  /**
   * All book cards currently shown in the bookshelf. Book cards are
   * `div[role="button"]`; the trailing "+" import tile is a `<button>`, so it
   * is naturally excluded.
   */
  bookCards(): Locator {
    return this.bookshelf.locator('div[role="button"]');
  }

  /**
   * Import a book file via the empty-state chooser's "From Local File" option.
   *
   * The file `<input>` is created off-DOM (see `useFileSelector.selectFileWeb`),
   * so a `filechooser` event must be awaited rather than locating an
   * `<input type="file">`.
   */
  async importBook(filePath: string): Promise<void> {
    await this.emptyStateImportButton.click();
    await this.importDialog.waitFor({ state: 'visible' });

    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.localFileImportButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  }

  async openFirstBook(): Promise<void> {
    await this.bookCards().first().click();
  }
}
