// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/components/BookCover', () => ({ default: () => <div data-testid='book-cover' /> }));
vi.mock('@/app/library/components/ReadingProgress', () => ({
  default: () => <div data-testid='reading-progress' />,
}));

const BookItem = (await import('@/app/library/components/BookItem')).default;

const book: Book = {
  hash: 'cover-only-book',
  format: 'EPUB',
  title: 'Dune',
  author: 'Frank Herbert',
  createdAt: 0,
  updatedAt: 0,
  progress: [10, 100],
};

const renderBook = (coverOnly: boolean) => {
  useSettingsStore.setState({
    settings: { librarySkeuomorphicCovers: false } as SystemSettings,
  });
  return render(
    <BookItem
      book={book}
      mode='grid'
      coverOnly={coverOnly}
      coverFit='crop'
      isSelectMode={false}
      bookSelected={false}
      transferProgress={null}
      handleBookUpload={vi.fn()}
      handleBookDownload={vi.fn()}
      showBookDetailsModal={vi.fn()}
      showTimeRemaining={false}
    />,
  );
};

afterEach(cleanup);

describe('BookItem Cover only mode (#7746)', () => {
  it('hides title and footer metadata in grid mode when cover only', () => {
    const { container } = renderBook(true);
    expect(screen.getByTestId('book-cover')).toBeTruthy();
    expect(screen.queryByText('Dune')).toBeNull();
    expect(screen.queryByTestId('reading-progress')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Book Details' })).toBeNull();
    const main = container.querySelector('.bookitem-main');
    expect(main?.getAttribute('title')).toBe('Dune');
  });

  it('keeps the cover tile itself unchanged, corners and shadow included', () => {
    const coverClass = () => document.querySelector('.bookitem-main')?.className;
    renderBook(true);
    const on = coverClass();
    cleanup();
    renderBook(false);
    expect(on).toBe(coverClass());
  });

  it('shows title and footer metadata in grid mode otherwise', () => {
    renderBook(false);
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByTestId('reading-progress')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show Book Details' })).toBeTruthy();
  });
});
