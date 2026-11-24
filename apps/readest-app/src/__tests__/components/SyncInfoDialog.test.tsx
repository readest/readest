// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';

const saveKOSyncFilename = vi.fn(async () => {});
const envConfig = { getAppService: vi.fn() };

vi.mock('@/services/bookMetadataEdit', () => ({
  saveKOSyncFilename: (...args: unknown[]) => saveKOSyncFilename(...(args as [])),
}));
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
  useBookDataStore.setState({
    booksData: {
      h1: { id: 'h1', book, file: null, config: null, bookDoc: null, isFixedLayout: false },
    },
  });
  render(<SyncInfoDialog isOpen bookKey='h1-view1' metadata={book.metadata} onClose={vi.fn()} />);
};

beforeEach(() => {
  saveKOSyncFilename.mockClear();
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

  test('leaves a name synced in while the dialog is open alone on a blur without edits', () => {
    setUp({}, makeBook('Old name.epub'));
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    act(() => {
      useBookDataStore.setState((state) => ({
        booksData: { h1: { ...state.booksData['h1']!, book: makeBook('Synced name.epub') } },
      }));
    });

    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(saveKOSyncFilename).not.toHaveBeenCalled();
  });

  test("saves a typed name as the book's own and lets a format fill it", () => {
    const book = makeBook('Doe, Jane - My Book.epub');
    setUp({}, book);
    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    expect(input.value).toBe('Doe, Jane - My Book.epub');

    fireEvent.change(input, { target: { value: '  Typed name.epub ' } });
    fireEvent.blur(input);
    expect(saveKOSyncFilename).toHaveBeenLastCalledWith(envConfig, book, 'Typed name.epub');

    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    expect(input.value).toBe('server-name.epub');
    expect(saveKOSyncFilename).toHaveBeenLastCalledWith(envConfig, book, 'server-name.epub');

    // The name the File Name Format gives is no override: the book follows the
    // format again.
    fireEvent.click(screen.getByRole('button', { name: 'Author - Title' }));
    expect(input.value).toBe('Jane Doe - My Book.epub');
    expect(saveKOSyncFilename).toHaveBeenLastCalledWith(envConfig, book, undefined);
  });
});
