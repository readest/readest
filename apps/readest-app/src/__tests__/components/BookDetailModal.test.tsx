import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailModal from '@/components/metadata/BookDetailModal';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const appSvc = {
  getBookFileSize: vi.fn(async () => 1024),
  fetchBookDetails: vi.fn(async () => null),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appSvc }, appService: appSvc }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: true,
      metadataDescriptionCollapsed: true,
    },
  }),
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

vi.mock('@/services/environment', () => ({ isWebAppPlatform: () => false }));

vi.mock('@/libs/metadata', () => ({ searchMetadata: vi.fn(async () => []) }));

// Render the cover with the same src-resolution as the real <BookCover> so we
// can assert which cover the view actually shows.
vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: ({ book }: { book: Book }) => (
    // biome-ignore lint/a11y/useAltText: test mock
    <img data-testid='cover' src={book.metadata?.coverImageUrl || book.coverImageUrl || ''} />
  ),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  // biome-ignore lint/a11y/useAltText: test mock
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

// Chrome we don't exercise — keep imports cheap and side-effect free.
vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));
// Expose the confirm callback with the purge flag so we can assert routing
// without driving the real toggle UI (covered by DeleteConfirmAlert.test.tsx).
vi.mock('@/components/DeleteConfirmAlert', () => ({
  __esModule: true,
  default: ({
    showPurgeToggle,
    onConfirm,
  }: {
    showPurgeToggle?: boolean;
    onConfirm: (purgeData: boolean) => void;
  }) => (
    <div data-testid='delete-confirm' data-purge-toggle={String(!!showPurgeToggle)}>
      <button onClick={() => onConfirm(false)}>confirm-keep-data</button>
      <button onClick={() => onConfirm(true)}>confirm-purge-data</button>
    </div>
  ),
}));
vi.mock('@/components/metadata/SourceSelector', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/Spinner', () => ({ __esModule: true, default: () => null }));

afterEach(() => cleanup());

const makeBook = (): Book =>
  ({
    hash: 'abc123',
    title: 'Old Title',
    author: 'Old Author',
    format: 'EPUB',
    coverImageUrl: 'old-cover',
    primaryLanguage: 'en',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {
      title: 'Old Title',
      author: 'Old Author',
      language: 'en',
      coverImageUrl: 'old-cover',
    },
  }) as Book;

describe('BookDetailModal cover refresh after save', () => {
  it('updates the Book Details view cover when the cover is edited and saved', async () => {
    const book = makeBook();
    const onUpdate = vi.fn();
    render(
      <BookDetailModal book={book} isOpen onClose={vi.fn()} handleBookMetadataUpdate={onUpdate} />,
    );

    // The view initially shows the original cover.
    await waitFor(() => expect(screen.getByTestId('cover').getAttribute('src')).toBe('old-cover'));

    // Edit → remove the cover → save.
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    fireEvent.click(await screen.findByTitle('Remove cover image'));
    fireEvent.click(screen.getByText('Save'));

    expect(onUpdate).toHaveBeenCalledTimes(1);

    // The details view must reflect the saved cover change without needing the
    // modal to be reopened (the bug: it kept showing the stale `book` prop).
    await waitFor(() => {
      expect(screen.getByTestId('cover').getAttribute('src')).not.toBe('old-cover');
    });
    expect(screen.getByTestId('cover').getAttribute('src')).toBe('_blank');
  });
});

describe('BookDetailModal purge-on-delete routing', () => {
  const renderModal = (handlers: { handleBookDelete: () => void; handleBookPurge: () => void }) =>
    render(
      <DropdownProvider>
        <BookDetailModal
          book={makeBook()}
          isOpen
          onClose={vi.fn()}
          handleBookDelete={handlers.handleBookDelete}
          handleBookDeleteCloudBackup={vi.fn()}
          handleBookDeleteLocalCopy={vi.fn()}
          handleBookPurge={handlers.handleBookPurge}
        />
      </DropdownProvider>,
    );

  const openStandardDelete = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('button[aria-label="Delete Book Options"]')!);
    fireEvent.click(screen.getByText('Remove from Cloud & Device'));
  };

  it('shows the purge toggle on the standard delete and routes to purge when enabled', () => {
    const handleBookDelete = vi.fn();
    const handleBookPurge = vi.fn();
    const { container } = renderModal({ handleBookDelete, handleBookPurge });

    openStandardDelete(container);
    expect(screen.getByTestId('delete-confirm').getAttribute('data-purge-toggle')).toBe('true');

    fireEvent.click(screen.getByText('confirm-purge-data'));
    expect(handleBookPurge).toHaveBeenCalledTimes(1);
    expect(handleBookDelete).not.toHaveBeenCalled();
  });

  it('routes the standard delete to a plain delete when the toggle is off', () => {
    const handleBookDelete = vi.fn();
    const handleBookPurge = vi.fn();
    const { container } = renderModal({ handleBookDelete, handleBookPurge });

    openStandardDelete(container);
    fireEvent.click(screen.getByText('confirm-keep-data'));
    expect(handleBookDelete).toHaveBeenCalledTimes(1);
    expect(handleBookPurge).not.toHaveBeenCalled();
  });
});
