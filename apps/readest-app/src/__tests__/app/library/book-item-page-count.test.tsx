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
  book,
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

describe('page count badge on library covers (#6909)', () => {
  it.each(['grid', 'list'] as const)('badges the cover in %s view', (mode) => {
    const { container } = render(<BookItem {...props} mode={mode} pageCount={412} />);
    expect(container.querySelector('.bookitem-main')!.contains(screen.getByText('412p'))).toBe(
      true,
    );
  });

  it('shows no badge without a page count', () => {
    render(<BookItem {...props} mode='grid' />);
    expect(screen.queryByText('412p')).toBeNull();
  });

  it('sits in the opposite corner from the series index', () => {
    render(<BookItem {...props} mode='grid' seriesIndex={3} pageCount={412} />);
    expect(screen.getByText('412p').className).toContain('start-1');
    expect(screen.getByText('#3').className).toContain('end-1');
  });
});
