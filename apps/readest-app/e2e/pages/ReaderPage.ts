import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The reader page (`/reader/{ids}` on web).
 *
 * There is intentionally no `goto()` — callers must reach the reader by
 * opening a book from {@link LibraryPage}, because `/reader` depends on the
 * book already being present in local storage.
 */
export class ReaderPage extends BasePage {
  readonly viewer: Locator;
  readonly foliateView: Locator;
  readonly headerBar: Locator;
  readonly footerBar: Locator;

  constructor(page: Page) {
    super(page);
    this.viewer = page.locator('.foliate-viewer').first();
    this.foliateView = page.locator('foliate-view').first();
    this.headerBar = page.locator('.header-bar').first();
    this.footerBar = page.locator('.footer-bar').first();
  }

  /** Wait until the reader route is active and the book viewer has mounted. */
  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/\/reader/);
    await this.viewer.waitFor({ state: 'visible' });
    await this.foliateView.waitFor({ state: 'attached' });
  }

  async nextPage(): Promise<void> {
    await this.page.keyboard.press('ArrowRight');
  }

  async prevPage(): Promise<void> {
    await this.page.keyboard.press('ArrowLeft');
  }

  /**
   * Reveal the auto-hidden header bar by clicking its top hover strip.
   * The header bar exists in the DOM at all times but is `opacity-0` until
   * revealed.
   */
  async revealHeader(): Promise<void> {
    const box = await this.viewer.boundingBox();
    if (box) {
      await this.page.mouse.click(box.x + box.width / 2, box.y + 4);
    }
  }
}
