import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

afterEach(cleanup);

it.each([390, 768, 1024])('can close a full-screen mobile notebook at %ipx', async (width) => {
  await page.viewport(width, 1024);
  const handleClose = vi.fn();
  render(
    <NotebookHeader
      bookKey='book-1'
      activeTab='notes'
      isFullScreenMobile
      isPinned={false}
      handleClose={handleClose}
      handleTogglePin={vi.fn()}
    />,
  );

  const close = screen.getByRole('button', { name: 'Close' });
  const rect = close.getBoundingClientRect();
  expect(rect.right).toBe(width - 12);
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(handleClose).toHaveBeenCalledOnce();
});

it('preserves the phone back button for a partial-height sheet', async () => {
  await page.viewport(390, 844);
  render(
    <NotebookHeader
      bookKey='book-1'
      activeTab='notes'
      isPinned={false}
      handleClose={vi.fn()}
      handleTogglePin={vi.fn()}
    />,
  );
  const close = screen.getByRole('button', { name: 'Close' });
  expect(close.getBoundingClientRect().left).toBe(12);
});

it('preserves the desktop header controls', async () => {
  await page.viewport(1024, 768);
  render(
    <NotebookHeader
      bookKey='book-1'
      activeTab='notes'
      isPinned={false}
      handleClose={vi.fn()}
      handleTogglePin={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Pin Notebook' })).toBeTruthy();
});

it.each([
  [1024, false],
  [390, false],
  [390, true],
])("puts a tab's gear at the end of the header at %ipx (full screen: %s)", async (width, full) => {
  await page.viewport(width, 844);
  render(
    <NotebookHeader
      bookKey='book-1'
      activeTab='dictionary'
      isFullScreenMobile={full}
      isPinned={false}
      handleClose={vi.fn()}
      handleTogglePin={vi.fn()}
    />,
  );
  const gear = screen.getByRole('button', { name: 'Manage Dictionaries' }).getBoundingClientRect();
  const title = document.querySelector('.notebook-title')!.getBoundingClientRect();
  expect(gear.left).toBeGreaterThan(title.right);
  expect(gear.top).toBeGreaterThanOrEqual(0);
  expect(gear.bottom).toBeLessThanOrEqual(44);
  if (full) {
    // Close stays in the corner, the gear beside it.
    const close = screen.getByRole('button', { name: 'Close' }).getBoundingClientRect();
    expect(close.right).toBe(width - 12);
    expect(gear.right).toBeLessThanOrEqual(close.left);
  } else {
    expect(gear.right).toBe(width - 12);
  }
});
