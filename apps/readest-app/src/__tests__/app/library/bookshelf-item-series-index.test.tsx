import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

const bookItem = vi.hoisted(() => vi.fn((_props: { seriesIndex?: number }) => null));

vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: vi.fn() }, MenuItem: { new: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook: vi.fn() }) }));
vi.mock('@/app/library/components/BookItem', () => ({ default: bookItem }));
vi.mock('@/app/library/components/GroupItem', () => ({ default: () => null }));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;

const book: Book = {
  hash: 'series-book',
  format: 'EPUB',
  title: "Caliban's War",
  author: 'James S. A. Corey',
  createdAt: 0,
  updatedAt: 0,
  metadata: {
    title: "Caliban's War",
    author: 'James S. A. Corey',
    language: 'en',
    series: 'The Expanse',
    seriesIndex: 2,
  },
};
const renderItem = (
  overrides: { item?: Book; mode?: 'grid' | 'list'; showSeriesIndex?: boolean } = {},
) =>
  render(
    <BookshelfItem
      mode={overrides.mode ?? 'grid'}
      item={overrides.item ?? book}
      coverFit='crop'
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
      showSeriesIndex={overrides.showSeriesIndex ?? true}
    />,
  );
const lastSeriesIndex = () => bookItem.mock.lastCall?.[0].seriesIndex;

afterEach(() => {
  cleanup();
  bookItem.mockClear();
});

describe('series index on grid cards inside a series group (#6347)', () => {
  it('badges the cover and names the index in the card label', () => {
    renderItem();
    expect(lastSeriesIndex()).toBe(2);
    expect(screen.getByRole('button', { name: "Caliban's War #2" })).toBeTruthy();
  });

  it.each([
    ['outside a series group', { showSeriesIndex: false }],
    ['in list view', { mode: 'list' as const }],
    [
      'without a series index',
      { item: { ...book, metadata: { ...book.metadata!, seriesIndex: undefined } } },
    ],
    [
      'for a zero series index',
      { item: { ...book, metadata: { ...book.metadata!, seriesIndex: 0 } } },
    ],
  ])('keeps the plain title %s', (_label, overrides) => {
    renderItem(overrides);
    expect(lastSeriesIndex()).toBeUndefined();
    expect(screen.getByRole('button', { name: "Caliban's War" })).toBeTruthy();
  });
});
