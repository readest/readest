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

describe('book series in the library (#6347)', () => {
  it.each([
    'grid',
    'list',
  ] as const)('shows the series and number with title and progress in %s view', (mode) => {
    render(<BookItem {...props} book={book} mode={mode} />);
    const title = screen.getByRole('heading', { name: book.title });
    const series = screen.getByText('The Expanse #2');
    const progress = screen.getByRole('status', { name: '50%' });
    expect(title.compareDocumentPosition(series) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      series.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows a series name without a number in grid view', () => {
    render(
      <BookItem
        {...props}
        book={{ ...book, metadata: { ...book.metadata!, seriesIndex: undefined } }}
        mode='grid'
      />,
    );
    expect(screen.getByText('The Expanse')).toBeTruthy();
  });

  it.each([undefined, '', '   '])('omits an empty series row for series %j', (series) => {
    const metadata = series === undefined ? undefined : { ...book.metadata!, series };
    const { container } = render(<BookItem {...props} book={{ ...book, metadata }} mode='grid' />);
    expect(screen.getByRole('heading', { name: book.title })).toBeTruthy();
    expect(screen.getByRole('status', { name: '50%' })).toBeTruthy();
    expect(container.querySelector('p')).toBeNull();
  });
});
