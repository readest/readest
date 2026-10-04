import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const book: Book = {
  hash: 'series-book',
  title: "Caliban's War",
  author: 'James S. A. Corey',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [5, 10],
  metadata: {
    title: "Caliban's War",
    author: 'James S. A. Corey',
    language: 'en',
    series: 'The Expanse',
    seriesIndex: 2,
  },
};
const props = {
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showTimeRemaining: false,
};

afterEach(cleanup);

describe('series index badge on library grid covers (#6347)', () => {
  it('badges the cover with the series index inside a series group', () => {
    const { container } = render(<BookItem {...props} book={book} mode='grid' showSeriesIndex />);
    const badge = screen.getByText('#2');
    expect(container.querySelector('.bookitem-main')!.contains(badge)).toBe(true);
    // The breadcrumb already names the series, so the card adds no series row.
    expect(screen.queryByText('The Expanse #2')).toBeNull();
  });

  it('shows no badge outside a series group', () => {
    render(<BookItem {...props} book={book} mode='grid' />);
    expect(screen.queryByText('#2')).toBeNull();
    expect(screen.queryByText('The Expanse #2')).toBeNull();
  });

  it.each([undefined, 0, Number.NaN])('shows no badge for series index %j', (seriesIndex) => {
    render(
      <BookItem
        {...props}
        book={{ ...book, metadata: { ...book.metadata!, seriesIndex } }}
        mode='grid'
        showSeriesIndex
      />,
    );
    expect(screen.queryByText(/^#/)).toBeNull();
  });

  it('keeps the list row series text instead of a badge', () => {
    render(<BookItem {...props} book={book} mode='list' showSeriesIndex />);
    expect(screen.getByText('The Expanse #2')).toBeTruthy();
    expect(screen.queryByText('#2')).toBeNull();
  });
});
