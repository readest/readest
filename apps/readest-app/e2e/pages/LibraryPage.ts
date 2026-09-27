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
  readonly importMenu: Locator;
  readonly localFileImportItem: Locator;

  constructor(page: Page) {
    super(page);
    this.container = page.getByLabel(/^(Your Library|书库)$/);
    this.header = page.getByLabel(/^(Library Header|图书馆标题)$/);
    this.bookshelf = page.getByRole('main', { name: /^(Bookshelf|书架)$/ });
    this.searchInput = page.locator('.search-input');
    this.clearSearchButton = page.locator('[aria-label="Clear Search"]');
    this.emptyState = page.getByRole('heading', { name: /^(Start your library|开启你的书库)$/ });
    this.emptyStateImportButton = this.bookshelf.getByRole('button', {
      name: /^(Import Books|导入书籍)$/,
      exact: true,
    });
    this.importMenu = page.locator('.menu-container');
    this.localFileImportItem = this.importMenu.getByRole('menuitem', {
      name: /^(From Local File|从本地文件导入)$/,
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
   * Import a book file via the empty-state "Import Books" button, which opens
   * the same import menu as the library header "+" button.
   *
   * The file `<input>` is created off-DOM (see `useFileSelector.selectFileWeb`),
   * so a `filechooser` event must be awaited rather than locating an
   * `<input type="file">`.
   */
  async importBook(filePath: string | string[]): Promise<void> {
    await this.emptyStateImportButton.click();
    await this.localFileImportItem.waitFor({ state: 'visible' });

    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.localFileImportItem.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  }

  async openFirstBook(): Promise<void> {
    await this.bookCards().first().click();
  }
}
