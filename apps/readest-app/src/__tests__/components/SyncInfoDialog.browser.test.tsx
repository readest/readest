/**
 * Enter commits the KOSync file name typed in Sync Info (#7864). Dialog stops
 * every keydown from bubbling past its box, so a React onKeyDown on the field
 * never runs: it takes a real key press in the real Dialog to show the commit
 * works, hence a browser test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';

import type { Book } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';

const saveKOSyncFilename = vi.fn(async () => {});
const envConfig = { getAppService: vi.fn() };

vi.mock('@/services/bookMetadataEdit', () => ({
  saveKOSyncFilename: (...args: unknown[]) => saveKOSyncFilename(...(args as [])),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/hooks/useCloudSyncStatus', () => ({ useCloudSyncStatus: () => ({ providers: [] }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig, appService: {} }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

const { default: SyncInfoDialog } = await import('@/app/reader/components/SyncInfoDialog');
await import('@/styles/globals.css');

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'My Book',
  author: 'Jane Doe',
  originalFilename: 'server-name.epub',
  metadata: { title: 'My Book', author: 'Jane Doe', language: 'en' },
  createdAt: 1,
  updatedAt: 1,
} as Book;

describe('SyncInfoDialog KOSync file name', () => {
  afterEach(() => {
    cleanup();
  });

  it('saves the typed name when Enter is pressed', async () => {
    useSettingsStore.setState({
      settings: { kosync: { enabled: true, checksumMethod: 'filename' } },
    } as never);
    useBookDataStore.setState({
      booksData: {
        h1: { id: 'h1', book, file: null, config: null, bookDoc: null, isFixedLayout: false },
      },
    });
    render(<SyncInfoDialog isOpen bookKey='h1-view1' metadata={book.metadata} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'File Name' }) as HTMLInputElement;
    expect(input.value).toBe('server-name.epub');
    await userEvent.clear(input);
    await userEvent.type(input, 'Doe, Jane - My Book.epub');
    await userEvent.keyboard('{Enter}');

    expect(saveKOSyncFilename).toHaveBeenCalledWith(envConfig, book, 'Doe, Jane - My Book.epub');
    expect(document.activeElement).not.toBe(input);
  });
});
