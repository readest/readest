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
vi.mock('@/app/library/components/ReadingProgress', () => ({ default: () => null }));

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

const renderBook = (mode: 'grid' | 'list', libraryCoverOnly: boolean) => {
  useSettingsStore.setState({
    settings: { libraryCoverOnly, librarySkeuomorphicCovers: false } as SystemSettings,
  });
  return render(
    <BookItem
      book={book}
      mode={mode}
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
  it('hides title and footer metadata in grid mode when libraryCoverOnly is enabled', () => {
    const { container } = renderBook('grid', true);
    expect(screen.getByTestId('book-cover')).toBeTruthy();
    expect(screen.queryByText('Dune')).toBeNull();
    const main = container.querySelector('.bookitem-main');
    expect(main?.getAttribute('title')).toBe('Dune');
    expect(main?.className).toContain('rounded-none');
  });

  it('shows title in grid mode when libraryCoverOnly is disabled', () => {
    renderBook('grid', false);
    expect(screen.getByText('Dune')).toBeTruthy();
  });

  it('always shows title in list mode even when libraryCoverOnly is enabled', () => {
    renderBook('list', true);
    expect(screen.getByText('Dune')).toBeTruthy();
  });
});
