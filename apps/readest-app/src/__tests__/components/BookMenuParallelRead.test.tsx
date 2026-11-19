import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { Book, BookFormat } from '@/types/book';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({ openParallelView: vi.fn() }),
}));

// eslint-disable-next-line import/first
import BookMenu from '@/app/reader/components/sidebar/BookMenu';

const makeBook = (
  hash: string,
  title: string,
  format: BookFormat,
  downloadedAt: number | null = 1,
): Book => ({
  hash,
  format,
  title,
  author: 'Author',
  createdAt: 0,
  updatedAt: 0,
  downloadedAt,
});

beforeEach(() => {
  (useSettingsStore.setState as unknown as (state: unknown) => void)({
    settings: DEFAULT_SYSTEM_SETTINGS,
  });
  (useReaderStore.setState as unknown as (state: unknown) => void)({
    bookKeys: ['book1'],
    viewStates: { book1: { viewSettings: {} } },
  });
  useSidebarStore.setState({ sideBarBookKey: 'book1' });
  useLibraryStore.getState().setLibrary([
    makeBook('epub-hash', 'An EPUB Book', 'EPUB'),
    makeBook('pdf-hash', 'A PDF Book', 'PDF'),
  ]);
});

afterEach(() => {
  cleanup();
});

describe('BookMenu Parallel Read book list', () => {
  it('lists downloaded EPUB books', () => {
    render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: 'An EPUB Book' })).toBeTruthy();
  });

  it('lists downloaded PDF books so a PDF can be opened in parallel (#4991)', () => {
    render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: 'A PDF Book' })).toBeTruthy();
  });

  it('lists the book being read even when it has no downloadedAt stamp (#4991)', () => {
    // A local book with no cloud copy opens without ever being stamped, so the
    // book on screen must not drop out of its own Parallel Read list.
    useLibraryStore.getState().setLibrary([makeBook('book1', 'Open PDF', 'PDF', null)]);
    render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: 'Open PDF' })).toBeTruthy();
  });

  it('still hides books that are not on this device and not open', () => {
    useLibraryStore
      .getState()
      .setLibrary([
        makeBook('book1', 'Open PDF', 'PDF'),
        makeBook('cloud', 'Cloud Book', 'EPUB', null),
      ]);
    render(<BookMenu />);
    expect(screen.queryByRole('menuitem', { name: 'Cloud Book' })).toBeNull();
  });
});
