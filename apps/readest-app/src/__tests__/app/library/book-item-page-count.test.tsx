import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, params?: { count?: number }) =>
    text.replace('{{count}}', String(params?.count)),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({ useMedianPageDurationSecs: () => null }));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const book: Book = {
  hash: 'paged-book',
  title: 'Dune',
  author: 'Frank Herbert',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  pageCount: 412,
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

describe('page count under the title of library books (#6909)', () => {
  it.each([
    'grid',
    'list',
  ] as const)('shows the count under the title of an unopened book in %s view, not on the cover', (mode) => {
    const { container } = render(<BookItem {...props} book={book} mode={mode} pageCount={412} />);
    const label = screen.getByText('412 pages');
    expect(container.querySelector('.bookitem-main')!.contains(label)).toBe(false);
  });

  it('follows the reading progress of a book being read', () => {
    render(
      <BookItem {...props} book={{ ...book, progress: [206, 412] }} mode='grid' pageCount={412} />,
    );
    expect(screen.getByText('50% · 412 pages')).toBeTruthy();
  });

  it('sits beside the Finished badge', () => {
    render(
      <BookItem
        {...props}
        book={{ ...book, readingStatus: 'finished' }}
        mode='grid'
        pageCount={412}
      />,
    );
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('412 pages')).toBeTruthy();
  });

  it('shows nothing without a page count', () => {
    render(<BookItem {...props} book={{ ...book, progress: [206, 412] }} mode='grid' />);
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.queryByText(/pages/)).toBeNull();
  });
});
