import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useReaderProgressStore } from '@/store/readerProgressStore';
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

const makeBook = (hash: string, title: string, format: BookFormat): Book => ({
  hash,
  format,
  title,
  author: 'Author',
  createdAt: 0,
  updatedAt: 0,
  downloadedAt: 1,
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
  useLibraryStore
    .getState()
    .setLibrary([
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
    expect(screen.getByRole('menuitem', { name: /An EPUB Book/ })).toBeTruthy();
  });

  it('lists downloaded PDF books so a PDF can be opened in parallel (#4991)', () => {
    render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: /A PDF Book/ })).toBeTruthy();
  });
});

describe('BookMenu Enter Parallel Sync', () => {
  beforeEach(() => {
    (useReaderStore.setState as unknown as (state: unknown) => void)({
      bookKeys: ['book1', 'book2'],
      viewStates: { book1: { viewSettings: {} }, book2: { viewSettings: {} } },
    });
    useParallelViewStore.setState({ parallelViews: [], sectionAnchors: {} });
    (useReaderProgressStore.setState as unknown as (state: unknown) => void)({
      progresses: {
        book1: { section: { current: 3, total: 30 } },
        book2: { section: { current: 13, total: 30 } },
      },
    });
  });

  // The same book open twice, its English half beside its Swedish half.
  it('keeps the sections the books are on in step (#4991)', () => {
    render(<BookMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Parallel Sync' }));

    const { areParallels, getSectionOffset } = useParallelViewStore.getState();
    expect(areParallels('book1', 'book2')).toBe(true);
    expect(getSectionOffset('book1', 'book2')).toBe(10);
  });
});
