import { cleanup, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookItem from '@/app/library/components/BookItem';
import type { Book } from '@/types/book';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));
await import('@/styles/globals.css');
afterEach(cleanup);

const book: Book = {
  hash: 'long-title',
  title: 'The long journey across the mountains and back again: an illustrated edition',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};

const renderTitle = (title: string, width: number, mode: 'list' | 'grid' = 'list') => {
  render(
    <div style={{ width }}>
      <BookItem
        mode={mode}
        book={{ ...book, title }}
        coverFit='crop'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={vi.fn()}
        showTimeRemaining={false}
      />
    </div>,
  );
  return screen.getByRole('heading', { name: title });
};

describe('library book titles', () => {
  it.each([
    book.title,
    'LongUnbrokenBookTitle'.repeat(6),
  ])('shows all lines in a phone-width list for %s', async (title) => {
    await page.viewport(390, 844);
    const heading = renderTitle(title, 358);

    expect(heading.clientHeight).toBeGreaterThan(parseFloat(getComputedStyle(heading).lineHeight));
    expect(heading.scrollHeight).toBe(heading.clientHeight);
    expect(heading.scrollWidth).toBe(heading.clientWidth);
    expect(screen.getByText(book.author).getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    );
  });

  it('keeps titles to one line in a wide list', async () => {
    await page.viewport(1024, 768);
    const heading = renderTitle(book.title, 400);

    expect(heading.clientHeight).toBeCloseTo(parseFloat(getComputedStyle(heading).lineHeight), 0);
    expect(heading.scrollHeight).toBeGreaterThan(heading.clientHeight);
  });

  it('keeps titles to one line in a phone-width grid', async () => {
    await page.viewport(390, 844);
    const heading = renderTitle(book.title, 160, 'grid');

    expect(heading.clientHeight).toBeCloseTo(parseFloat(getComputedStyle(heading).lineHeight), 0);
    expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth);
  });
});
