import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

const bookItem = vi.hoisted(() => vi.fn((_props: { pageCount?: number }) => null));

vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: vi.fn() }, MenuItem: { new: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, params?: { count?: number }) =>
    text.replace('{{count}}', String(params?.count)),
}));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook: vi.fn() }) }));
vi.mock('@/app/library/components/BookItem', () => ({ default: bookItem }));
vi.mock('@/app/library/components/GroupItem', () => ({ default: () => null }));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;

const book: Book = {
  hash: 'paged-book',
  format: 'EPUB',
  title: 'Dune',
  author: 'Frank Herbert',
  createdAt: 0,
  updatedAt: 0,
  pageCount: 412,
};
const renderItem = (item: Book, showPageCount: boolean) =>
  render(
    <BookshelfItem
      mode='grid'
      item={item}
      coverFit='crop'
      showPageCount={showPageCount}
      isSelectMode={false}
      itemSelected={false}
      transferProgress={null}
      setLoading={vi.fn()}
      toggleSelection={vi.fn()}
      handleGroupBooks={vi.fn()}
      handleBookUpload={vi.fn()}
      handleBookDownload={vi.fn()}
      handleBookDelete={vi.fn()}
      handleSetSelectMode={vi.fn()}
      handleShowDetailsBook={vi.fn()}
      handleLibraryNavigation={vi.fn()}
      handleUpdateReadingStatus={vi.fn()}
      showTimeRemaining={false}
    />,
  );
const lastPageCount = () => bookItem.mock.lastCall?.[0].pageCount;

afterEach(() => {
  cleanup();
  bookItem.mockClear();
});

describe('page count on covers of a shelf that shows it (#6909)', () => {
  it('badges the cover and names the count in the card label', () => {
    renderItem(book, true);
    expect(lastPageCount()).toBe(412);
    expect(screen.getByRole('button', { name: 'Dune, 412 pages' })).toBeTruthy();
  });

  it('prefers the total the reader recorded once the book was opened', () => {
    renderItem({ ...book, progress: [10, 271] }, true);
    expect(lastPageCount()).toBe(271);
  });

  it.each([
    ['on a shelf that hides it', book, false],
    ['for an audiobook', { ...book, format: 'ABS' as const, duration: 3600 }, true],
    ['without a known count', { ...book, pageCount: undefined }, true],
  ])('keeps the plain title %s', (_label, item, showPageCount) => {
    renderItem(item, showPageCount);
    expect(lastPageCount()).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Dune' })).toBeTruthy();
  });
});
