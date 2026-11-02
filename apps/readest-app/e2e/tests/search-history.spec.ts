import { expect, test } from '../fixtures/base';
import { SAMPLE_EPUB } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

// Run against an isolated dev server with READEST_HISTORY_TEST_URL when port 3000
// is already serving another worktree.
const libraryUrl = process.env['READEST_HISTORY_TEST_URL'] ?? '/library';

test('reuses a search immediately after clearing it and persists history deletion', async ({
  page,
}) => {
  await page.goto(libraryUrl);
  const library = new LibraryPage(page);
  await library.importBook(SAMPLE_EPUB);
  await expect(library.bookCards()).toHaveCount(1);
  const input = page.getByRole('textbox', { name: 'Search Books', exact: true });
  await input.fill('Alice');
  await expect(page).toHaveURL(/q=Alice/);
  await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await input.click();
  await page.getByRole('button', { name: 'Alice', exact: true }).click();
  await expect(input).toHaveValue('Alice');
  await expect(page).toHaveURL(/q=Alice/);
  await expect(library.bookCards()).toHaveCount(1);

  await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await input.click();
  await page.getByRole('button', { name: 'Remove Alice from search history' }).click();
  await expect(page.getByRole('region', { name: 'Search history' })).toBeHidden();
  await page.reload();
  await input.click();
  await expect(page.getByRole('region', { name: 'Search history' })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('search-history-library-books'))).toBe(
    '[]',
  );

  await page.getByRole('button', { name: 'Search Books', exact: true }).click();
  const textInput = page.getByRole('textbox', { name: 'Full Text Search', exact: true });
  await textInput.fill('Alice');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('search-history-library')))
    .toContain('Alice');
  await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await textInput.click();
  await page.getByRole('button', { name: 'Alice', exact: true }).click();
  await expect(textInput).toHaveValue('Alice');
  await expect(page).toHaveURL(/q=Alice/);
  await page.getByRole('button', { name: 'Clear Search', exact: true }).click();
  await textInput.click();
  await page.getByRole('button', { name: 'Clear search history' }).click();
  await expect(page.getByRole('region', { name: 'Search history' })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('search-history-library'))).toBeNull();
});
