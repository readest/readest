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
  hash: 'tagged',
  title: 'Tagged',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [5, 10],
  tags: ['Fiction', 'Sci-Fi'],
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

describe('book tags in the library list view', () => {
  it('shows the tags between the progress and the action icons', () => {
    render(<BookItem {...props} book={book} mode='list' />);
    const tags = screen.getByLabelText('Tags');
    expect(tags.textContent).toBe('FictionSci-Fi');
    const progress = screen.getByRole('status');
    expect(progress.nextElementSibling).toBe(tags);
  });

  it('does not show tags in the grid view', () => {
    render(<BookItem {...props} book={book} mode='grid' />);
    expect(screen.queryByLabelText('Tags')).toBeNull();
  });

  it('shows each tag once, trimmed, skipping blanks', () => {
    render(
      <BookItem
        {...props}
        book={{ ...book, tags: [' Fiction ', 'Fiction', '', 'Sci-Fi'] }}
        mode='list'
      />,
    );
    const chips = Array.from(screen.getByLabelText('Tags').children).map((el) => el.textContent);
    expect(chips).toEqual(['Fiction', 'Sci-Fi']);
  });

  it('renders nothing for a book without tags', () => {
    render(<BookItem {...props} book={{ ...book, tags: [] }} mode='list' />);
    expect(screen.queryByLabelText('Tags')).toBeNull();
  });
});
