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
  readonly dictionaryPopup: Locator;
  readonly translatorPopup: Locator;
  readonly proofreadPopup: Locator;
  readonly noteEditor: Locator;
  readonly annotationItems: Locator;
  readonly rangeHandles: Locator;
  readonly pageJumpInput: Locator;

  constructor(page: Page) {
    super(page);
    // Both the desktop footer bar and the mobile navigation panel render a
    // page-jump input; pick whichever one the current layout displays.
    this.pageJumpInput = page.locator('input[aria-label="Go to Page"]:visible').first();
    this.viewer = page.locator('.foliate-viewer').first();
    this.foliateView = page.locator('foliate-view').first();
    this.headerBar = page.locator('.header-bar').first();
    this.footerBar = page.locator('.footer-bar').first();
    this.sidebar = page.locator('[role="navigation"][aria-label="Sidebar"]');
    this.notebook = page.locator('[role="group"][aria-label="Notebook"]');
    this.tocItems = page.locator('.toc-list [role="treeitem"]');
    this.searchResults = page.locator('.search-results li[role="button"]');
    this.annotationPopup = page.locator('.selection-popup');
    // The dictionary shares Popup's `.popup-container` chrome with the
    // translator, so key off its results header test id instead.
    this.dictionaryPopup = page.locator('.popup-container:has([data-testid="dict-title"])');
    this.translatorPopup = page.locator('.popup-container:has(h1:text-is("Original Text"))');
    this.proofreadPopup = page.locator('.popup-container:has-text("Selected text:")');
    this.noteEditor = page.locator('.note-editor-container');
    this.annotationItems = page.locator('li.booknote-item[role="button"]');
    // The app-drawn range-edit handles (the selection / annotation range
    // editors), as opposed to the browser's native selection handles.
    this.rangeHandles = page.locator('[data-testid="selection-handle"]');
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

  /** Whether the header bar is currently taking pointer events. */
  async isHeaderRevealed(): Promise<boolean> {
    // The bar auto-hides with `opacity-0 pointer-events-none`, which Playwright
    // still reports as visible (it keeps a bounding box), so read the styles.
    return this.headerBar.evaluate((bar) => {
      const style = getComputedStyle(bar);
      return style.pointerEvents !== 'none' && Number(style.opacity) > 0.1;
    });
  }

  /** Hide the header and footer bars by tapping the middle of the page. */
  async hideChrome(): Promise<void> {
    if (!(await this.isHeaderRevealed())) return;
    const box = await this.viewer.boundingBox();
    if (!box) return;
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => this.isHeaderRevealed()).toBe(false);
  }

  // --- pagination & progress ---

  async nextPage(): Promise<void> {
    await this.page.keyboard.press('ArrowRight');
  }

  async prevPage(): Promise<void> {
    await this.page.keyboard.press('ArrowLeft');
  }

  /**
   * Current reading position as a number parsed from the footer's page-jump
   * label ("94 / 251" with the default fraction progress style). The label is
   * in the DOM regardless of whether the footer is visually revealed, so no
   * reveal is needed.
   */
  async readingProgress(): Promise<number> {
    const value = await this.pageJumpInput.inputValue();
    const match = value.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : Number.NaN;
  }

  /** Jump to a page by typing into the footer's page-jump input. */
  async goToPage(page: number): Promise<void> {
    await this.revealFooter();
    await this.pageJumpInput.click();
    await this.pageJumpInput.fill(String(page));
    await this.pageJumpInput.press('Enter');
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
   * Open the settings dialog from the header's view menu. The header used to
   * carry a dedicated "Font & Layout" button, but it duplicated the mobile
   * footer's Font tab and was removed (#5652); the view menu's "Settings"
   * entry is the header's remaining route into the dialog.
   */
  async openSettings(): Promise<void> {
    await this.revealHeader();
    await this.headerBar.locator('button[aria-label="View Options"]').click();
    await this.page.locator('.view-menu').getByText('Settings', { exact: true }).click();
  }

  /**
   * Open the settings dialog, increase the default font size by one step,
   * and return the value before and after.
   */
  async increaseFontSize(): Promise<{ before: string; after: string }> {
    await this.openSettings();
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

  /**
   * Add an annotation tool to the selection toolbar via
   * Settings -> Behavior -> Customize Toolbar, by its chip label.
   */
  async enableAnnotationTool(name: string): Promise<void> {
    await this.openSettings();
    await this.page.locator('[data-tab="Control"]').click();
    await this.page.locator('[data-setting-id="settings.control.customizeToolbar"]').click();
    await this.page.getByRole('button', { name, exact: true }).click();
    await this.page.keyboard.press('Escape');
  }

  /**
   * Turn the in-page header band (the running section title) on or off from
   * the settings dialog. With it off the book text moves up to the compact top
   * margin, right under the header bar's hover strip.
   */
  async setPageHeaderVisible(visible: boolean): Promise<void> {
    await this.openSettings();
    await this.page.locator('[data-tab="Layout"]').click();

    const toggle = this.page
      .locator('[data-setting-id="settings.layout.showHeader"]')
      .getByRole('checkbox')
      .first();
    await toggle.waitFor({ state: 'visible' });
    await toggle.setChecked(visible);

    await this.page.keyboard.press('Escape');
    await this.hideChrome();
  }

  /**
   * Geometry of the topmost line of book text on the current page, in
   * top-document coordinates, plus whatever element the browser hit-tests at
   * its middle (`'reader'` when the press would reach the book).
   *
   * Reading the line out of the section document and asking the top document
   * who owns that point runs the same hit test the pointer pipeline uses, which
   * is what an overlay strip breaks.
   */
  private async firstLineHitTest(): Promise<{ top: number; owner: string } | null> {
    return this.page.evaluate(() => {
      const view = document.querySelector('foliate-view') as HTMLElement & {
        renderer: { getContents: () => { doc?: Document }[] };
      };
      if (!view) return null;
      const lines: { top: number; left: number; height: number; width: number }[] = [];
      for (const { doc } of view.renderer.getContents()) {
        const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
        if (!doc || !frame) continue;
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if ((node.textContent ?? '').trim().length < 10) continue;
          const range = doc.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            // Skip slivers (inline markup) and anything off the visible page.
            if (rect.width < 40 || rect.height < 5) continue;
            const left = frame.left + rect.left;
            const top = frame.top + rect.top;
            if (left < 0 || left > window.innerWidth - 40) continue;
            if (top < 0 || top + rect.height > window.innerHeight) continue;
            lines.push({ top, left, height: rect.height, width: rect.width });
          }
        }
      }
      const line = lines.sort((a, b) => a.top - b.top)[0];
      if (!line) return null;
      const el = document.elementFromPoint(
        line.left + Math.min(line.width, 160) / 2,
        line.top + line.height / 2,
      );
      const viewer = document.querySelector('.foliate-viewer');
      const owner =
        el && viewer?.contains(el) ? 'reader' : `${el?.tagName}.${String(el?.className)}`;
      return { top: line.top, owner };
    });
  }

  /**
   * Page forward until the topmost line of the page starts within `maxTop` px
   * of the cell top, then hit-test it (see {@link firstLineHitTest}). A chapter
   * opens on a heading that sits well below the top, so the caller cannot
   * assume the first page has a line up there.
   */
  async firstLineHitTestNearTop(
    maxTop: number,
    maxPages = 8,
  ): Promise<{ top: number; owner: string } | null> {
    let hit = await this.firstLineHitTest();
    for (let i = 0; i < maxPages && (!hit || hit.top >= maxTop); i += 1) {
      await this.nextPage();
      await this.page.waitForTimeout(400);
      hit = await this.firstLineHitTest();
    }
    return hit;
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
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const iframes = this.page.locator('.foliate-viewer iframe');
      const frameCount = await iframes.count();
      for (let i = 0; i < frameCount; i += 1) {
        const paragraphs = iframes.nth(i).contentFrame().locator('p');
        // A frame may be detaching mid-navigation; skip it if so.
        const paragraphCount = await paragraphs.count().catch(() => 0);
        for (let j = 0; j < Math.min(paragraphCount, 30); j += 1) {
          const box = await paragraphs
            .nth(j)
            .boundingBox()
            .catch(() => null);
          // Accept a paragraph that intersects the viewport — off-screen
          // prerendered sections sit fully outside it.
          if (
            box &&
            box.width > 120 &&
            box.height > 16 &&
            box.x < viewport.width &&
            box.x + box.width > 0 &&
            box.y < viewport.height &&
            box.y + box.height > 0
          ) {
            return iframes.nth(i).contentFrame();
          }
        }
      }
      await this.page.waitForTimeout(400);
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

  /**
   * Select a single word of book text.
   *
   * The instant quick action only fires for a single lookup term, and it fires
   * off the selection itself — so unlike {@link selectText} this waits for no
   * popup, leaving the spec to say which one it expects.
   */
  async selectWord(): Promise<void> {
    await this.openTocChapter(3);
    const frame = await this.visibleSectionFrame();

    await frame.locator('body').evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll('p'));
      const target = paragraphs.find((p) => (p.textContent ?? '').trim().length > 60);
      if (!target) {
        throw new Error('no selectable paragraph in the visible section');
      }
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      let word: { node: Node; start: number; end: number } | null = null;
      while (textNode && !word) {
        const text = textNode.textContent ?? '';
        const match = /[A-Za-z]{4,}/.exec(text);
        if (match) {
          word = { node: textNode, start: match.index, end: match.index + match[0].length };
        }
        textNode = walker.nextNode();
      }
      if (!word) {
        throw new Error('no single word found in the target paragraph');
      }
      const range = document.createRange();
      range.setStart(word.node, word.start);
      range.setEnd(word.node, word.end);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  /** The text currently selected inside the on-screen book section. */
  async selectedSectionText(): Promise<string> {
    const frame = await this.visibleSectionFrame();
    return frame.locator('body').evaluate(() => document.getSelection()?.toString() ?? '');
  }

  /**
   * Turn on an instant quick action (`Instant Dictionary`, `Instant Highlight`,
   * …) from the header bar's quick-action dropdown.
   */
  async setQuickAction(action: string): Promise<void> {
    await this.revealHeader();
    await this.headerBar.getByRole('button', { name: 'Enable Quick Action on Selection' }).click();
    await this.page.getByRole('menuitem', { name: `Instant ${action}` }).click();
  }

  /** A tool button inside the annotation popup, by its accessible name. */
  popupTool(name: string | RegExp): Locator {
    return this.annotationPopup.getByRole('button', { name });
  }

  async highlightSelection(): Promise<void> {
    await this.popupTool('Highlight').click();
  }

  /**
   * Click the first highlight drawn in the book, opening its toolbar and
   * range editor.
   *
   * The overlay is an SVG laid over its section iframe in that iframe's own
   * client coordinates, so a point just inside the highlight path's top-left
   * corner (the start of its first line — {@link selectText} selects from a
   * paragraph start) is a point on the highlighted text in that document. The
   * click is dispatched there rather than through the page mouse, so it also
   * reaches a highlight in a prerendered section that is not on screen.
   */
  async clickHighlight(): Promise<void> {
    const overlay = this.foliateView.locator('svg g path').first();
    await overlay.waitFor({ state: 'attached' });
    await overlay.evaluate((node) => {
      const path = node as SVGPathElement;
      const box = path.getBBox();
      const doc = path.ownerSVGElement?.parentElement?.querySelector('iframe')?.contentDocument;
      if (!doc) throw new Error('highlight overlay has no section document');
      doc.dispatchEvent(
        new MouseEvent('click', { clientX: box.x + 4, clientY: box.y + 4, bubbles: true }),
      );
    });
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

  /** Read the system clipboard (the context must grant `clipboard-read`). */
  async readClipboard(): Promise<string> {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  /** Dismiss the annotation popup if it is open. */
  async dismissPopup(): Promise<void> {
    if (await this.annotationPopup.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await this.annotationPopup.waitFor({ state: 'hidden' }).catch(() => {});
    }
  }

  /**
   * Close the notebook pane if it is open. An unpinned notebook renders a
   * full-screen capture overlay that would swallow clicks aimed at the
   * sidebar, so tests must close it before driving other panels.
   */
  async closeNotebook(): Promise<void> {
    if (await this.notebook.isVisible().catch(() => false)) {
      await this.page
        .locator('.overlay[data-capture-blocking-overlay]')
        .last()
        .click({ position: { x: 8, y: 200 } });
      await this.notebook.waitFor({ state: 'hidden' }).catch(() => {});
    }
  }

  /**
   * Open the sidebar's "Annotate" tab, which lists the book's annotations
   * (assert against {@link annotationItems} afterwards).
   */
  async openAnnotationsTab(): Promise<void> {
    await this.dismissPopup();
    await this.closeNotebook();
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
