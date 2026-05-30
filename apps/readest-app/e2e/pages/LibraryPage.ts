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

  constructor(page: Page) {
    super(page);
    this.container = page.locator('[aria-label="Your Library"]');
    this.header = page.locator('[aria-label="Library Header"]');
    this.bookshelf = page.locator('[aria-label="Bookshelf"]');
    this.searchInput = page.locator('.search-input');
    this.clearSearchButton = page.locator('[aria-label="Clear Search"]');
    this.emptyState = page.getByRole('heading', { name: 'Start your library' });
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
   * Import a book file via the empty-state "Import Books" button.
   *
   * The file `<input>` is created off-DOM (see `useFileSelector.selectFileWeb`),
   * so a `filechooser` event must be awaited rather than locating an
   * `<input type="file">`.
   */
  async importBook(filePath: string): Promise<void> {
    const importButton = this.page.locator('.hero').getByRole('button', { name: 'Import Books' });
    const chooserPromise = this.page.waitForEvent('filechooser');
    await importButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  }

  async openFirstBook(): Promise<void> {
    await this.bookCards().first().click();
  }
}
