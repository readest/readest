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

    const chapterProgress = await reader.readingProgress();
    expect(chapterProgress).toBeGreaterThan(startProgress);
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
