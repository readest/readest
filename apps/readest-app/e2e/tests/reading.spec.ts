import { expect, test } from '../fixtures/base';

test.describe('Reading', () => {
  test('opens an EPUB and turns pages', async ({ openBook }) => {
    const reader = await openBook();

    await expect(reader.viewer).toBeVisible();
    await reader.nextPage();
    await reader.nextPage();
    await reader.prevPage();
    await expect(reader.viewer).toBeVisible();
  });

  test('navigates chapters via the table of contents', async ({ openBook }) => {
    const reader = await openBook();
    const startProgress = await reader.readingProgress();

    await reader.openTocChapter(6);

    // Reading progress updates asynchronously after the section loads.
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(startProgress);
  });

  test('can return to the reading position after a chapter jump', async ({ page, openBook }) => {
    const reader = await openBook();
    const start = await reader.readingProgress();
    const history = page.getByRole('group', { name: 'Navigation History' });
    await expect(history).toHaveCount(0);

    await reader.openTocChapter(6);
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(start);
    const destination = await reader.readingProgress();

    await history.getByRole('button', { name: /^Go Back/ }).click();
    await expect.poll(() => reader.readingProgress()).toBe(start);
    await history.getByRole('button', { name: /^Go Forward/ }).click();
    await expect.poll(() => reader.readingProgress()).toBe(destination);
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(history).toHaveCount(0);

    await reader.nextPage();
    await expect(history).toHaveCount(0);
  });

  test('returns to the reading position after stepping through search results', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook();
    const start = await reader.readingProgress();
    const history = page.getByRole('group', { name: 'Navigation History' });

    await reader.search('Cheshire');
    await reader.searchResults.first().click();
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(start);
    const firstHit = await reader.readingProgress();
    await page.getByTitle('Next Result').click();
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(firstHit);

    await history.getByRole('button', { name: /^Go Back/ }).click();
    await expect.poll(() => reader.readingProgress()).toBe(start);
  });

  test('returns to the reading position after a page-number or slider jump', async ({
    page,
    openBook,
  }) => {
    const reader = await openBook();
    const start = await reader.readingProgress();
    const history = page.getByRole('group', { name: 'Navigation History' });
    const goBack = history.getByRole('button', { name: /^Go Back/ });

    await reader.goToPage(40);
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(start);
    await goBack.click();
    await expect.poll(() => reader.readingProgress()).toBe(start);

    await reader.revealFooter();
    const slider = page.getByRole('slider', { name: 'Jump to Location' });
    await slider.fill('50');
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(start);
    await slider.fill('70');
    await expect.poll(() => reader.readingProgress()).toBeGreaterThan(60);
    await goBack.click();
    await expect.poll(() => reader.readingProgress()).toBe(start);
  });

  test('jumps to an entered page number', async ({ openBook }) => {
    const reader = await openBook();
    const startProgress = await reader.readingProgress();
    const total = Number((await reader.pageJumpInput.inputValue()).split('/')[1]);
    const target = Math.max(2, Math.round(total / 2));

    await reader.goToPage(target);

    // The jump aims at the middle of the target page, so the reported start
    // of the landed page may be off by one.
    await expect
      .poll(async () => Math.abs((await reader.readingProgress()) - target))
      .toBeLessThanOrEqual(1);
    expect(await reader.readingProgress()).not.toBe(startProgress);
  });

  test('finds matches with in-book search', async ({ openBook }) => {
    const reader = await openBook();

    const resultCount = await reader.search('Alice');

    expect(resultCount).toBeGreaterThan(0);
    await reader.searchResults.first().click();
    await expect(reader.viewer).toBeVisible();
  });

  test('increases the font size from the settings dialog', async ({ openBook }) => {
    const reader = await openBook();

    const { before, after } = await reader.increaseFontSize();

    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  test('zoom shortcuts step the font size of a reflowable book (#5694)', async ({ openBook }) => {
    const reader = await openBook();
    await reader.openTocChapter(3);
    const before = await reader.bookFontSize();

    await reader.pressZoomShortcut('=');
    await expect.poll(() => reader.bookFontSize()).toBe(before + 1);

    await reader.pressZoomShortcut('-');
    await expect.poll(() => reader.bookFontSize()).toBe(before);

    await reader.pressZoomShortcut('=');
    await reader.pressZoomShortcut('=');
    await expect.poll(() => reader.bookFontSize()).toBe(before + 2);

    await reader.pressZoomShortcut('0');
    await expect.poll(() => reader.bookFontSize()).toBe(before);
  });

  test('adds and removes a bookmark', async ({ openBook }) => {
    const reader = await openBook();
    await reader.revealHeader();

    await expect(reader.addBookmarkButton).toBeVisible();
    await reader.addBookmarkButton.click();
    await expect(reader.removeBookmarkButton).toBeVisible();

    await reader.removeBookmarkButton.click();
    await expect(reader.addBookmarkButton).toBeVisible();
  });
});
