import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HardcoverLinkDialog from '@/app/reader/components/hardcover/HardcoverLinkDialog';
import type { HardcoverBookCandidate } from '@/services/hardcover';

const h = vi.hoisted(() => ({
  config: { updatedAt: 1, hardcover: undefined as { bookId: number; title: string } | undefined },
  book: { hash: 'book-hash', title: 'Project Hail Mary', author: 'Andy Weir', format: 'EPUB' },
  searchBooks: vi.fn(),
  clearForBook: vi.fn(async (_bookHash: string) => {}),
  setConfig: vi.fn(),
  saveConfig: vi.fn(async () => {}),
  toasts: [] as Array<{ message: string; type: string }>,
}));

vi.mock('@/components/Dialog', () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, params?: Record<string, string | number>) =>
    Object.entries(params ?? {}).reduce(
      (result, [key, replacement]) => result.replace(`{{${key}}}`, String(replacement)),
      value,
    ),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {}, envConfig: { getAppService: async () => ({}) } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({
      getConfig: () => h.config,
      getBookData: () => ({ book: h.book }),
      setConfig: h.setConfig,
      saveConfig: h.saveConfig,
    }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { hardcover: { enabled: true, accessToken: 'tok', lastSyncedAt: 0 } },
  }),
}));

vi.mock('@/services/hardcover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/hardcover')>();
  return {
    pickAutoMatch: actual.pickAutoMatch,
    HardcoverClient: class {
      searchBooks(query: string) {
        return h.searchBooks(query);
      }
    },
    HardcoverSyncMapStore: class {
      clearForBook(bookHash: string) {
        return h.clearForBook(bookHash);
      }
    },
  };
});

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (name: string, detail: unknown) => {
      if (name === 'toast') h.toasts.push(detail as { message: string; type: string });
    },
  },
}));

const candidates: HardcoverBookCandidate[] = [
  {
    bookId: 111,
    title: 'Project Hail Mary (audiobook)',
    authors: ['Ray Porter'],
    coverUrl: null,
    releaseYear: 2021,
    pages: null,
    readersCount: 3,
    readable: false,
    onShelf: false,
  },
  {
    bookId: 222,
    title: 'Project Hail Mary',
    authors: ['Andy Weir'],
    coverUrl: 'https://assets.hardcover.app/cover.jpg',
    releaseYear: 2021,
    pages: 476,
    readersCount: 1200,
    readable: true,
    onShelf: true,
  },
];

const ebookLink = { bookId: 222, title: 'Project Hail Mary' };
const audiobookLink = { bookId: 111, title: 'Project Hail Mary (audiobook)' };

describe('HardcoverLinkDialog', () => {
  beforeEach(() => {
    h.config.hardcover = undefined;
    h.searchBooks.mockReset().mockResolvedValue(candidates);
    h.clearForBook.mockClear();
    h.setConfig.mockClear();
    h.saveConfig.mockClear();
    h.toasts.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('searches with the book title and author on open and lists results with shelf and format hints', async () => {
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Link Hardcover Book' })).toBeTruthy();
    await screen.findByText('Project Hail Mary (audiobook)');
    expect(h.searchBooks).toHaveBeenCalledWith('Project Hail Mary Andy Weir');
    expect(screen.getByText('Project Hail Mary')).toBeTruthy();
    expect(screen.getByText('On your shelf')).toBeTruthy();
    expect(screen.getByText('Audiobook')).toBeTruthy();
    expect(screen.getByText(/Andy Weir · 2021 · 476 pages/)).toBeTruthy();
  });

  it('links the tapped book, saves it to the book config, and closes', async () => {
    const onClose = vi.fn();
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={onClose} />);

    fireEvent.click(await screen.findByText('Project Hail Mary'));

    await waitFor(() =>
      expect(h.saveConfig).toHaveBeenCalledWith(
        expect.anything(),
        'book-hash-view',
        expect.objectContaining({ hardcover: ebookLink }),
        expect.anything(),
      ),
    );
    expect(h.setConfig).toHaveBeenCalledWith('book-hash-view', { hardcover: ebookLink });
    // First link: no journal entries can belong to another book yet.
    expect(h.clearForBook).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([{ type: 'info', message: 'Linked to “Project Hail Mary”' }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('forgets note mappings when switching to a different Hardcover book', async () => {
    h.config.hardcover = audiobookLink;
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Project Hail Mary'));

    await waitFor(() => expect(h.clearForBook).toHaveBeenCalledWith('book-hash'));
    expect(h.setConfig).toHaveBeenCalledWith('book-hash-view', { hardcover: ebookLink });
  });

  it('forgets note mappings on a first link that differs from the automatic match', async () => {
    // No link recorded yet (pre-feature install), but notes may already have
    // been synced under what the automatic match would pick (222, on shelf).
    // Linking elsewhere means those journal entries belong to another book.
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Project Hail Mary (audiobook)'));

    await waitFor(() => expect(h.clearForBook).toHaveBeenCalledWith('book-hash'));
    expect(h.setConfig).toHaveBeenCalledWith('book-hash-view', { hardcover: audiobookLink });
  });

  it('shows the current link and lets the user unlink it', async () => {
    h.config.hardcover = audiobookLink;
    const onClose = vi.fn();
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={onClose} />);

    expect(screen.getByText('Currently linked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));

    await waitFor(() =>
      expect(h.setConfig).toHaveBeenCalledWith('book-hash-view', { hardcover: undefined }),
    );
    expect(h.clearForBook).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('re-runs the search with an edited query', async () => {
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={vi.fn()} />);
    await screen.findByText('Project Hail Mary');

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Artemis' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(h.searchBooks).toHaveBeenLastCalledWith('Artemis'));
  });

  it('surfaces a failed search instead of an empty list', async () => {
    h.searchBooks.mockRejectedValue(new Error('Hardcover API Error: 500'));
    render(<HardcoverLinkDialog bookKey='book-hash-view' onClose={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Hardcover API Error: 500');
    expect(screen.queryByText(/No matching books found/)).toBeNull();
  });
});
