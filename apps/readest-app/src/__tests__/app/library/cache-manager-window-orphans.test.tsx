import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CacheManagerWindow,
  setCacheManagerDialogVisible,
} from '@/app/library/components/CacheManagerWindow';
import type { Book } from '@/types/book';
import type { FileItem } from '@/types/system';

/**
 * Manage Cache folds orphaned book files under Books/ into the clearable set
 * (#5837). The dialog must say so before the user confirms, the orphan scan
 * must only run against a loaded library, and Clear must delete exactly the
 * set the dialog described. The real cache utils run here against a fake
 * AppService filesystem, so the numbers on screen come from real scans.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const BOOKS_DIR = '/data/Books';
const fs: Record<string, FileItem[]> = { Cache: [], Temp: [], Books: [] };

const appService = {
  isIOSApp: false,
  isAndroidApp: false,
  resolveFilePath: vi.fn(async () => BOOKS_DIR),
  readDirectory: vi.fn(async (dir: string, base: string) =>
    base === 'None' && dir === BOOKS_DIR ? fs['Books']! : (fs[base] ?? []),
  ),
  // Every dir was last written long ago, so none is held back as in-flight.
  stats: vi.fn(async () => ({ mtime: new Date(0) })),
  deleteFile: vi.fn(async (_path: string, _base: string) => undefined),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig: {} }),
}));

const libraryState = { library: [] as Book[], libraryLoaded: true };

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => libraryState },
}));

vi.mock('@tauri-apps/api/path', () => ({
  documentDir: vi.fn(async () => '/docs'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

// Preserve the dialog id so the component's getElementById event wiring works.
vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children: React.ReactNode;
  }) => (
    <div id={id} role='dialog' aria-label={title}>
      {children}
    </div>
  ),
}));

const LIVE = 'live-hash';
const ORPHAN = 'orphan-hash';
// The orphan dir holds a book file and a cover; only the book file is
// reclaimable, so the cover never counts.
const ORPHAN_CAPTION = 'Includes 1 orphaned book file(s) not in your library';
const PLAIN_NOTICE = 'This will delete all cached files. This cannot be undone.';
const ORPHAN_NOTICE =
  'This will delete all cached files and orphaned book files not in your library. This cannot be undone.';

const openDialog = async () => {
  render(<CacheManagerWindow />);
  await act(async () => {
    setCacheManagerDialogVisible(true);
  });
};

beforeEach(() => {
  libraryState.library = [{ hash: LIVE } as Book];
  libraryState.libraryLoaded = true;
  fs['Cache'] = [{ path: 'thumb.png', size: 100 }];
  fs['Temp'] = [];
  fs['Books'] = [
    { path: 'library.json', size: 10 },
    { path: `${LIVE}/book.epub`, size: 5000 },
    { path: `${LIVE}/cover.png`, size: 300 },
    { path: `${ORPHAN}/book.epub`, size: 1000 },
    { path: `${ORPHAN}/cover.png`, size: 200 },
  ];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CacheManagerWindow orphaned book files (#5837)', () => {
  it('counts orphans in the total and captions them when the library is loaded', async () => {
    await openDialog();

    expect(await screen.findByText('2 files')).toBeTruthy();
    expect(screen.getByText(ORPHAN_CAPTION)).toBeTruthy();
  });

  it('shows no orphan caption when there are none', async () => {
    fs['Books'] = fs['Books']!.filter((f) => !f.path.startsWith(ORPHAN));

    await openDialog();

    expect(await screen.findByText('1 files')).toBeTruthy();
    expect(screen.queryByText(/orphaned book file/)).toBeNull();
  });

  it('does not walk the Books tree until the library is loaded', async () => {
    libraryState.libraryLoaded = false;

    await openDialog();

    expect(await screen.findByText('1 files')).toBeTruthy();
    expect(screen.queryByText(/orphaned book file/)).toBeNull();
    expect(appService.readDirectory).not.toHaveBeenCalledWith(BOOKS_DIR, 'None');
  });

  it('enables Clear Cache when only orphans exist', async () => {
    fs['Cache'] = [];

    await openDialog();

    expect(await screen.findByText('1 files')).toBeTruthy();
    const clear = screen.getByRole('button', { name: 'Clear Cache' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
  });

  it('warns that orphaned book files will be deleted before confirming', async () => {
    await openDialog();
    await screen.findByText('2 files');

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));

    expect(screen.getByText(ORPHAN_NOTICE)).toBeTruthy();
    expect(screen.getByText(ORPHAN_CAPTION)).toBeTruthy();
  });

  it('keeps the plain confirm notice when there are no orphans', async () => {
    fs['Books'] = fs['Books']!.filter((f) => !f.path.startsWith(ORPHAN));

    await openDialog();
    await screen.findByText('1 files');

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));

    expect(screen.getByText(PLAIN_NOTICE)).toBeTruthy();
    expect(screen.queryByText(/orphaned book file/)).toBeNull();
  });

  it('deletes exactly the cache and orphan files the user confirmed, never live books', async () => {
    await openDialog();
    await screen.findByText('2 files');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));

    // A file that lands after the scan is not part of what the user confirmed.
    fs['Books']!.push({ path: 'late-hash/book.epub', size: 1 });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Clear' }));
    });

    expect(await screen.findByText('Cache cleared')).toBeTruthy();
    expect(appService.deleteFile.mock.calls).toEqual([
      ['thumb.png', 'Cache'],
      [`${ORPHAN}/book.epub`, 'Books'],
    ]);
    // The post-clear rescan still sees orphans on the fake disk, but the
    // caption only belongs to the idle/confirming states.
    expect(screen.queryByText(/orphaned book file/)).toBeNull();
  });

  it('spares a shown orphan whose book got a live row while confirming', async () => {
    // A sync or import can persist a book between the scan and the confirm.
    await openDialog();
    await screen.findByText('2 files');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));

    libraryState.library = [...libraryState.library, { hash: ORPHAN } as Book];

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Clear' }));
    });

    expect(await screen.findByText('Cache cleared')).toBeTruthy();
    expect(appService.deleteFile.mock.calls).toEqual([['thumb.png', 'Cache']]);
  });

  it('reports files it could not delete instead of claiming the cache is cleared', async () => {
    appService.deleteFile.mockImplementation(async (path: string) => {
      if (path === `${ORPHAN}/book.epub`) throw new Error('EBUSY');
      return undefined;
    });

    await openDialog();
    await screen.findByText('2 files');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Cache' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Clear' }));
    });

    expect(await screen.findByText('Failed to delete 1 file(s)')).toBeTruthy();
    expect(screen.queryByText('Cache cleared')).toBeNull();
  });
});
