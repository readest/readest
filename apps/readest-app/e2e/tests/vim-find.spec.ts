import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { SAMPLE_PDF } from '../fixtures/books';

// Vim-style find (#7281): `/` searches the book and selects the match, `n`/`N`
// step through matches, motion keys extend the selection until Esc.

// The selection in any rendered section, with the text node and offset it
// starts at and the section (a PDF page) it is on, so a test can tell one match
// from another.
const bookSelection = (page: Page) =>
  page.evaluate(() => {
    type Renderer = { getContents: () => { doc: Document; index?: number }[] };
    const view = document.querySelector('foliate-view') as unknown as { renderer?: Renderer };
    for (const { doc, index } of view?.renderer?.getContents() ?? []) {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const context = sel.anchorNode?.textContent ?? '';
        return { text: sel.toString(), context, offset: sel.anchorOffset, index };
      }
    }
    return { text: '', context: '', offset: -1, index: undefined };
  });

const selectedText = async (page: Page) => (await bookSelection(page)).text;

// Whether the selection lies inside the renderer's viewport, mapped through the
// (possibly scaled) frame of the page it is on.
const selectionOnScreen = (page: Page) =>
  page.evaluate(() => {
    type Renderer = HTMLElement & { getContents: () => { doc: Document }[] };
    const view = document.querySelector('foliate-view') as unknown as { renderer?: Renderer };
    const renderer = view?.renderer;
    for (const { doc } of renderer?.getContents() ?? []) {
      const sel = doc.getSelection();
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      if (!renderer || !frame || !sel?.rangeCount || sel.isCollapsed) continue;
      const box = frame.getBoundingClientRect();
      const scale = box.height / frame.offsetHeight;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const viewport = renderer.getBoundingClientRect();
      return (
        box.top + rect.top * scale >= viewport.top &&
        box.top + rect.bottom * scale <= viewport.bottom
      );
    }
    return false;
  });

const find = async (page: Page, term: string) => {
  // `/` acts on a rendered book; wait for the first section to be laid out.
  await expect
    .poll(() =>
      page.evaluate(() => {
        type Renderer = { getContents: () => unknown[] };
        const view = document.querySelector('foliate-view') as unknown as { renderer?: Renderer };
        return (view?.renderer?.getContents() ?? []).length;
      }),
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: 'Find on Page' });
  await input.fill(term);
  await input.press('Enter');
};

test.describe('Vim find', () => {
  test('/ selects the first match and shows the match count', async ({ openBook, page }) => {
    const reader = await openBook();

    await find(page, 'Alice');

    await expect.poll(() => selectedText(page)).toBe('Alice');
    await expect(reader.annotationPopup).toBeVisible();
    await expect(page.locator('.vim-command-line')).toContainText('/Alice');
    await expect(page.locator('.vim-command-line')).toContainText(/\[1\/\d+\]/);
    // The Enter that ran the search isn't also Toggle Toolbar, which would
    // raise the bars and put the keys on a footer button.
    expect(await reader.isHeaderRevealed()).toBe(false);
    expect(await page.evaluate(() => !!document.activeElement?.closest('.footer-bar'))).toBe(false);
  });

  test('n and N step through matches instead of opening the Notebook', async ({
    openBook,
    page,
  }) => {
    const reader = await openBook();
    await find(page, 'Alice');
    await expect.poll(() => selectedText(page)).toBe('Alice');
    // `[1/N]` without the trailing `+`: every match is in.
    await expect(page.locator('.vim-command-line')).toContainText(/\[1\/\d+\]/);
    const first = (await bookSelection(page)).context;

    await page.keyboard.press('n');
    await expect.poll(async () => (await bookSelection(page)).context).not.toBe(first);
    await expect(page.locator('.vim-command-line')).toContainText(/\[2\/\d+\]/);
    await expect(reader.notebook).toBeHidden();

    await page.keyboard.press('Shift+N');
    await expect.poll(async () => (await bookSelection(page)).context).toBe(first);
    await expect(page.locator('.vim-command-line')).toContainText(/\[1\/\d+\]/);
  });

  test('motion keys extend the selection and o swaps its ends', async ({ openBook, page }) => {
    const reader = await openBook();
    await find(page, 'Alice was beginning');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning');

    await page.keyboard.press('e');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning to');
    await page.keyboard.press('w');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning to ');
    await page.keyboard.press('b');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning ');
    await page.keyboard.press('h');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning');
    await page.keyboard.press('o');
    await page.keyboard.press('l');
    await expect.poll(() => selectedText(page)).toBe('lice was beginning');
    await expect(reader.annotationPopup).toBeVisible();
  });

  test('line and paragraph motions reach their boundaries', async ({ openBook, page }) => {
    await openBook();
    await find(page, 'Alice was beginning');
    await expect.poll(() => selectedText(page)).toBe('Alice was beginning');

    await page.keyboard.press('Shift+$');
    await expect.poll(() => selectedText(page)).toMatch(/^Alice was beginning to get [^\n]+$/);
    await page.keyboard.press('Shift+}');
    await expect.poll(() => selectedText(page)).toMatch(/conversation\?”$/);
    await page.keyboard.press('Shift+}');
    await expect.poll(() => selectedText(page)).toMatch(/ran close by her\.$/);
    const paragraphs = await selectedText(page);
    // Start of the line the moving end is on: within the second paragraph.
    await page.keyboard.press('0');
    await expect
      .poll(async () => (await selectedText(page)).length)
      .toBeLessThan(paragraphs.length);
    expect(await selectedText(page)).toMatch(/conversation\?”\s+So she/);
    // Start of that paragraph: only the first one stays selected.
    await page.keyboard.press('Shift+{');
    await expect.poll(async () => (await selectedText(page)).trimEnd()).toMatch(/conversation\?”$/);
  });

  test('a match never runs the instant quick action, nor does extending it', async ({
    openBook,
    page,
  }) => {
    const reader = await openBook();
    await reader.setQuickAction('Dictionary');

    await find(page, 'Alice');
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.dictionaryPopup).toBeHidden();

    await page.keyboard.press('e');
    await expect.poll(() => selectedText(page)).not.toBe('Alice');
    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.dictionaryPopup).toBeHidden();
  });

  test('Esc ends vim mode and gives the keys back', async ({ openBook, page }) => {
    const reader = await openBook();
    await find(page, 'Alice');
    await expect.poll(() => selectedText(page)).toBe('Alice');

    await page.keyboard.press('Escape');

    await expect.poll(() => selectedText(page)).toBe('');
    await expect(page.locator('.vim-command-line')).toBeHidden();
    await page.keyboard.press('n');
    await expect(reader.notebook).toBeVisible();
  });

  // The sidebar search keeps its behaviour: a result is gone to, not selected.
  test('a sidebar search result is still only navigated to', async ({ openBook, page }) => {
    const reader = await openBook();
    await reader.search('Alice');
    await reader.searchResults.nth(1).click();
    await page.waitForTimeout(1000);

    expect(await selectedText(page)).toBe('');
    await expect(reader.annotationPopup).toBeHidden();
  });
});

// PDF pages are fixed-layout frames whose text layer pdf.js renders after the
// page loads; the match is selected in that layer.
test.describe('Vim find in a PDF', () => {
  test('/ selects a match on a later page and n / N step through matches', async ({
    openBook,
    page,
  }) => {
    const reader = await openBook(SAMPLE_PDF);

    await find(page, 'Dinah');

    // "Dinah" first appears on page 4.
    await expect.poll(() => bookSelection(page)).toMatchObject({ text: 'Dinah', index: 3 });
    await expect(reader.annotationPopup).toBeVisible();
    // `[1/N]` without the trailing `+`: every match is in, so N can wrap.
    await expect(page.locator('.vim-command-line')).toContainText(/\[1\/\d+\]/);
    // The next match may be on the same line: tell them apart by offset too.
    const where = async () => {
      const { context, offset } = await bookSelection(page);
      return `${context}@${offset}`;
    };
    const first = await where();

    await page.keyboard.press('n');
    await expect.poll(where).not.toBe(first);
    expect(await selectedText(page)).toBe('Dinah');
    await expect(page.locator('.vim-command-line')).toContainText(/\[2\/\d+\]/);
    await expect(reader.notebook).toBeHidden();

    // Back to the first match, then wrap to the last one, pages later.
    await page.keyboard.press('Shift+N');
    await expect.poll(where).toBe(first);
    await page.keyboard.press('Shift+N');
    await expect.poll(async () => (await bookSelection(page)).index ?? 0).toBeGreaterThan(3);
    expect(await selectedText(page)).toBe('Dinah');
    await expect(reader.annotationPopup).toBeVisible();
  });

  test('motion keys extend the selection', async ({ openBook, page }) => {
    const reader = await openBook(SAMPLE_PDF);
    await find(page, 'anyone anywhere');
    await expect.poll(() => selectedText(page)).toBe('anyone anywhere');

    await page.keyboard.press('e');
    await expect.poll(() => selectedText(page)).toBe('anyone anywhere at');
    await page.keyboard.press('b');
    await expect.poll(() => selectedText(page)).toBe('anyone anywhere ');
    await page.keyboard.press('h');
    await expect.poll(() => selectedText(page)).toBe('anyone anywhere');
    await expect(reader.annotationPopup).toBeVisible();
  });

  test('scrolled mode selects the match', async ({ openBook, page }) => {
    const reader = await openBook(SAMPLE_PDF);
    // Right away, while the PDF is still opening: that switch once left the
    // scrolled strip hidden.
    await page.keyboard.press('Shift+J');
    await expect
      .poll(() =>
        page.evaluate(() => {
          type Renderer = { getAttribute: (name: string) => string | null };
          const view = document.querySelector('foliate-view') as unknown as {
            renderer?: Renderer;
          };
          return view?.renderer?.getAttribute('flow');
        }),
      )
      .toBe('scrolled');

    await find(page, 'Dinah');

    await expect.poll(() => bookSelection(page)).toMatchObject({ text: 'Dinah', index: 3 });
    // The page was pages below the view: the match is scrolled on screen.
    await expect.poll(() => selectionOnScreen(page)).toBe(true);
    await expect(reader.annotationPopup).toBeVisible();
  });
});
