// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';

// The real save helper runs, so the field shows what the store then hashes.
const saveLibraryBooks = vi.fn(async () => {});
const envConfig = { getAppService: vi.fn(async () => ({ saveLibraryBooks })) };

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useCloudSyncStatus', () => ({ useCloudSyncStatus: () => ({ providers: [] }) }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role='dialog'>{children}</div> : null,
}));

import SyncInfoDialog from '@/app/reader/components/SyncInfoDialog';

const makeBook = (kosyncFilename?: string): Book =>
  ({
    hash: 'h1',
    format: 'EPUB',
    title: 'My Book',
    author: 'Jane Doe',
    originalFilename: 'server-name.epub',
    metadata: { title: 'My Book', author: [{ name: 'Jane Doe' }], language: 'en', kosyncFilename },
    createdAt: 1,
    updatedAt: 1,
  }) as unknown as Book;

const setUp = (kosync: Partial<SystemSettings['kosync']>, book = makeBook()) => {
  useSettingsStore.setState({
    settings: {
      kosync: {
        enabled: true,
        checksumMethod: 'filename',
        filenameFormat: 'author-title',
        ...kosync,
      },
    },
  } as never);
  useLibraryStore.getState().setLibrary([book]);
  useBookDataStore.setState({
    booksData: {
      h1: { id: 'h1', book, file: null, config: null, bookDoc: null, isFixedLayout: false },
    },
  });
  render(<SyncInfoDialog isOpen bookKey='h1-view1' metadata={book.metadata} onClose={vi.fn()} />);
};

beforeEach(() => {
  saveLibraryBooks.mockClear();
});

const ownName = () => useBookDataStore.getState().getBookData('h1')!.book!.metadata?.kosyncFilename;
const syncIn = (name: string) =>
  act(() => {
    useBookDataStore.setState((state) => ({
      booksData: { h1: { ...state.booksData['h1']!, book: makeBook(name) } },
    }));
  });

afterEach(() => {
  cleanup();
});

describe('SyncInfoDialog KOSync file name (#7864)', () => {
  test('shows the file name KOSync hashes, built from the File Name Format', () => {
    setUp({});
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    expect(input.value).toBe('Jane Doe - My Book.epub');
  });

  test.each([
    ['File Content checksums', { checksumMethod: 'binary' as const }],
    ['KOSync off', { enabled: false }],
  ])('has no file name row with %s', (_label, kosync) => {
    setUp(kosync);
    expect(screen.queryByRole('textbox', { name: 'File Name' })).toBeNull();
  });

  test('shows a name synced in while the dialog is open, and leaves it alone on a blur', () => {
    setUp({}, makeBook('Old name.epub'));
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    syncIn('Synced name.epub');
    expect(input.value).toBe('Synced name.epub');

    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(ownName()).toBe('Synced name.epub');
    expect(saveLibraryBooks).not.toHaveBeenCalled();
  });

  test('keeps a draft being typed when a synced name arrives', () => {
    setUp({}, makeBook('Old name.epub'));
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Draft.epub' } });
    syncIn('Synced name.epub');
    expect(input.value).toBe('Draft.epub');
  });

  test("saves a typed name as the book's own and lets a format fill it", () => {
    setUp({}, makeBook('Doe, Jane - My Book.epub'));
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    expect(input.value).toBe('Doe, Jane - My Book.epub');

    fireEvent.change(input, { target: { value: '  Typed name.epub ' } });
    fireEvent.blur(input);
    expect(ownName()).toBe('Typed name.epub');
    expect(input.value).toBe('Typed name.epub');

    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    expect(ownName()).toBe('server-name.epub');
    expect(input.value).toBe('server-name.epub');

    // The name the File Name Format gives is no override: the book follows the
    // format again.
    fireEvent.click(screen.getByRole('button', { name: 'Author - Title' }));
    expect(ownName()).toBeUndefined();
    expect(input.value).toBe('Jane Doe - My Book.epub');
  });
});
