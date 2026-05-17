import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * The reader page (`/reader/{ids}` on web).
 *
 * There is intentionally no `goto()` — callers reach the reader by opening a
 * book (see the `openBook` fixture), because `/reader` depends on the book
 * already being present in local storage.
 *
 * The header and footer bars are auto-hidden until the book is hovered;
 * methods that need them call {@link revealHeader} / {@link revealFooter}.
 */
export class ReaderPage extends BasePage {
  readonly viewer: Locator;
  readonly foliateView: Locator;
  readonly headerBar: Locator;
  readonly footerBar: Locator;
  readonly sidebar: Locator;
  readonly notebook: Locator;
  readonly tocItems: Locator;
  readonly searchResults: Locator;
  readonly annotationPopup: Locator;
  readonly noteEditor: Locator;
  readonly annotationItems: Locator;

  constructor(page: Page) {
    super(page);
    this.viewer = page.locator('.foliate-viewer').first();
    this.foliateView = page.locator('foliate-view').first();
    this.headerBar = page.locator('.header-bar').first();
    this.footerBar = page.locator('.footer-bar').first();
    this.sidebar = page.locator('[role="navigation"][aria-label="Sidebar"]');
    this.notebook = page.locator('[role="group"][aria-label="Notebook"]');
    this.tocItems = page.locator('.toc-list [role="treeitem"]');
    this.searchResults = page.locator('.search-results li[role="button"]');
    this.annotationPopup = page.locator('.selection-popup');
    this.noteEditor = page.locator('.note-editor-container');
    this.annotationItems = page.locator('li.booknote-item[role="button"]');
  }

  /** Wait until the reader route is active and the book viewer has mounted. */
  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/\/reader/);
    await this.viewer.waitFor({ state: 'visible' });
    await this.foliateView.waitFor({ state: 'attached' });
  }

  // --- chrome (auto-hidden header / footer bars) ---

  /** Reveal the header bar by clicking its top hover strip. */
  async revealHeader(): Promise<void> {
    const box = await this.viewer.boundingBox();
    if (box) {
      await this.page.mouse.click(box.x + box.width / 2, box.y + 4);
    }
  }

  /** Reveal the footer bar by clicking its bottom hover strip. */
  async revealFooter(): Promise<void> {
    const box = await this.viewer.boundingBox();
    if (box) {
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
    }
  }

  // --- pagination & progress ---

  async nextPage(): Promise<void> {
    await this.page.keyboard.press('ArrowRight');
  }

  async prevPage(): Promise<void> {
    await this.page.keyboard.press('ArrowLeft');
  }

  /**
   * Current reading position as a number parsed from the footer's
   * "Reading Progress" label. The label is in the DOM regardless of whether
   * the footer is visually revealed, so no reveal is needed.
   */
  async readingProgress(): Promise<number> {
    const label =
      (await this.page
        .locator('span[title="Reading Progress"]')
        .first()
        .getAttribute('aria-label')) ?? '';
    const match = label.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : Number.NaN;
  }

  // --- sidebar / table of contents ---

  async openSidebar(): Promise<void> {
    if (await this.sidebar.isVisible()) return;
    await this.revealHeader();
    await this.page.locator('button[aria-label="Toggle Sidebar"]').first().click();
    await this.sidebar.waitFor({ state: 'visible' });
  }

  /** Open the sidebar and navigate to the TOC chapter at the given index. */
  async openTocChapter(index: number): Promise<void> {
    await this.openSidebar();
    await this.sidebar.locator('[aria-label="TOC"]').click();
    await this.tocItems.nth(index).click();
  }

  // --- in-book search ---

  /** Run an in-book search and return the number of results. */
  async search(term: string): Promise<number> {
    await this.openSidebar();
    await this.page.locator('button[title="Show Search Bar"]').click();
    await this.sidebar.locator('input.search-input').fill(term);
    await this.searchResults.first().waitFor({ state: 'visible' });
    return this.searchResults.count();
  }

  // --- reader settings ---

  /**
   * Open the settings dialog, increase the default font size by one step,
   * and return the value before and after.
   */
  async increaseFontSize(): Promise<{ before: string; after: string }> {
    await this.revealHeader();
    await this.headerBar.locator('button[aria-label="Font & Layout"]').click();
    await this.page.locator('[data-tab="Font"]').click();

    const row = this.page.locator('[data-setting-id="settings.font.defaultFontSize"]');
    const input = row.locator('input').first();
    await input.waitFor({ state: 'visible' });
    const before = await input.inputValue();
    await row.locator('[aria-label="Increase"]').click();
    await expect(input).not.toHaveValue(before);
    const after = await input.inputValue();

    await this.page.keyboard.press('Escape');
    return { before, after };
  }

  // --- bookmarks ---

  get addBookmarkButton(): Locator {
    return this.page.locator('button[aria-label="Add Bookmark"]');
  }

  get removeBookmarkButton(): Locator {
    return this.page.locator('button[aria-label="Remove Bookmark"]');
  }

  // --- text selection & annotations ---

  /**
   * Find the iframe of the on-screen book section.
   *
   * The reader prerenders adjacent sections into separate iframes, so this
   * scans every `.foliate-viewer iframe` and returns the one holding a `<p>`
   * whose bounding box actually falls inside the viewport.
   */
  private async visibleSectionFrame(): Promise<FrameLocator> {
    const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const iframes = this.page.locator('.foliate-viewer iframe');
      const frameCount = await iframes.count();
      for (let i = 0; i < frameCount; i += 1) {
        const frame = iframes.nth(i).contentFrame();
        const paragraphs = frame.locator('p');
        const paragraphCount = await paragraphs.count();
        for (let j = 0; j < Math.min(paragraphCount, 15); j += 1) {
          const box = await paragraphs.nth(j).boundingBox();
          if (
            box &&
            box.width > 120 &&
            box.height > 16 &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width &&
            box.y + box.height <= viewport.height
          ) {
            return frame;
          }
        }
      }
      await this.page.waitForTimeout(500);
    }
    throw new Error('no visible book section found in the viewer');
  }

  /**
   * Select a paragraph of book text and raise the annotation popup.
   *
   * Navigates to a chapter first so the page holds prose (the book opens on a
   * cover page). The selection is made inside the section iframe and a
   * `pointerup` is dispatched — the exact pair of signals the reader's
   * annotator listens for — because synthetic mouse drags do not reliably
   * produce a text selection through nested, paginated foliate iframes.
   */
  async selectText(): Promise<void> {
    await this.openTocChapter(3);
    const frame = await this.visibleSectionFrame();

    await frame.locator('body').evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('p'));
      const target = paragraphs.find((p) => (p.textContent ?? '').trim().length > 60);
      if (!target) {
        throw new Error('no selectable paragraph in the visible section');
      }
      // Select a span within a text node — the reader's CFI generation
      // expects text-node range endpoints, not element boundaries.
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && (textNode.textContent ?? '').trim().length < 20) {
        textNode = walker.nextNode();
      }
      if (!textNode) {
        throw new Error('no text node found in the target paragraph');
      }
      const length = textNode.textContent?.length ?? 0;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(length, 80));
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: rect.left + Math.min(20, rect.width / 2),
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          pointerType: 'mouse',
        }),
      );
    });
    await this.annotationPopup.waitFor({ state: 'visible' });
  }

  /** A tool button inside the annotation popup, by its accessible name. */
  popupTool(name: string | RegExp): Locator {
    return this.annotationPopup.getByRole('button', { name });
  }

  async highlightSelection(): Promise<void> {
    await this.popupTool('Highlight').click();
  }

  async selectHighlightColor(color: string): Promise<void> {
    await this.page.locator(`[aria-label="Select ${color} color"]`).click();
  }

  /** Annotate the current selection with a note. */
  async addNote(text: string): Promise<void> {
    await this.popupTool('Annotate').click();
    await this.noteEditor.waitFor({ state: 'visible' });
    await this.noteEditor.getByRole('textbox').fill(text);
    await this.notebook.getByRole('button', { name: 'Save' }).click();
  }

  /** Dismiss the annotation popup if it is open. */
  async dismissPopup(): Promise<void> {
    if (await this.annotationPopup.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await this.annotationPopup.waitFor({ state: 'hidden' }).catch(() => {});
    }
  }

  /**
   * Open the sidebar's "Annotate" tab, which lists the book's annotations
   * (assert against {@link annotationItems} afterwards).
   */
  async openAnnotationsTab(): Promise<void> {
    await this.dismissPopup();
    await this.openSidebar();
    await this.sidebar.locator('[aria-label="Annotate"]').click();
  }

  /** Delete the first annotation from the sidebar's "Annotate" tab. */
  async deleteFirstAnnotation(): Promise<void> {
    await this.openAnnotationsTab();
    const item = this.annotationItems.first();
    await item.hover();
    await item.getByRole('button', { name: 'Delete' }).click();
  }
}
