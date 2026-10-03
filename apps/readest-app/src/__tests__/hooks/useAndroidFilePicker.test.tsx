import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { AppService } from '@/types/system';

// #1217: picker results must arrive as a plugin event (replayed by the native
// pending-event queue) so they survive the WebView/process being torn down
// while the system file picker is in the foreground. These tests cover the JS
// half: a standing listener that turns `file-picker-result` payloads into
// book files for import.

type PluginEventHandler = (payload: { uris: string[] }) => void | Promise<void>;

const listeners: { plugin: string; event: string; handler: PluginEventHandler }[] = [];
const unregisterMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: async (plugin: string, event: string, handler: PluginEventHandler) => {
    listeners.push({ plugin, event, handler });
    return { unregister: unregisterMock };
  },
  invoke: vi.fn(),
}));

const basenameMock = vi.fn();

vi.mock('@tauri-apps/api/path', () => ({
  basename: (path: string) => basenameMock(path),
}));

import { useAndroidPickedBooks } from '@/hooks/useAndroidFilePicker';
import { eventDispatcher } from '@/utils/event';

const makeAppService = (isAndroidApp: boolean): AppService =>
  ({ isAndroidApp, isIOSApp: false }) as unknown as AppService;

beforeEach(() => {
  listeners.length = 0;
  unregisterMock.mockClear();
  basenameMock.mockReset();
  basenameMock.mockImplementation(async (path: string) => path.split('/').pop() || path);
});

afterEach(() => {
  cleanup();
});

describe('useAndroidPickedBooks', () => {
  test('registers a native-bridge file-picker-result listener on Android', async () => {
    const onPickedBooks = vi.fn();
    renderHook(() => useAndroidPickedBooks(makeAppService(true), onPickedBooks));

    await waitFor(() => {
      expect(listeners).toHaveLength(1);
    });
    expect(listeners[0]).toMatchObject({ plugin: 'native-bridge', event: 'file-picker-result' });
  });

  test('does not register outside Android', () => {
    const onPickedBooks = vi.fn();
    renderHook(() => useAndroidPickedBooks(makeAppService(false), onPickedBooks));
    expect(listeners).toHaveLength(0);
  });

  test('resolves display names and forwards only book files', async () => {
    const onPickedBooks = vi.fn();
    basenameMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/1')) return 'novel.epub';
      if (path.endsWith('/2')) return 'photo.png';
      throw new Error('no display name');
    });
    renderHook(() => useAndroidPickedBooks(makeAppService(true), onPickedBooks));
    await waitFor(() => expect(listeners).toHaveLength(1));

    await listeners[0]!.handler({
      uris: [
        'content://com.android.providers.media.documents/document/1',
        'content://com.android.providers.media.documents/document/2',
        // basename() throws for this one; the raw-URI fallback has no book
        // extension so it must be dropped, not crash the whole batch.
        'content://com.android.providers.downloads.documents/document/msf%3A20',
      ],
    });

    await waitFor(() => expect(onPickedBooks).toHaveBeenCalledTimes(1));
    expect(onPickedBooks).toHaveBeenCalledWith([
      { path: 'content://com.android.providers.media.documents/document/1', name: 'novel.epub' },
    ]);
  });

  test('ignores an empty payload without invoking the import callback', async () => {
    const onPickedBooks = vi.fn();
    renderHook(() => useAndroidPickedBooks(makeAppService(true), onPickedBooks));
    await waitFor(() => expect(listeners).toHaveLength(1));

    await listeners[0]!.handler({ uris: [] });

    expect(onPickedBooks).not.toHaveBeenCalled();
  });

  test('uses the latest import callback without re-registering the native listener', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const appService = makeAppService(true);
    const { rerender } = renderHook(({ cb }) => useAndroidPickedBooks(appService, cb), {
      initialProps: { cb: first },
    });
    await waitFor(() => expect(listeners).toHaveLength(1));

    rerender({ cb: second });

    // Re-registering on every render would thrash the native listener map
    // (and can drop queued events between unregister/register).
    expect(listeners).toHaveLength(1);
    await listeners[0]!.handler({ uris: ['content://docs/document/novel.epub'] });
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });
});

// Issue #5959: the native-bridge picker path runs the same whitelist as
// useFileSelector, so a re-download saved as "book.epub (1)" was dropped here
// too — and `if (books.length > 0)` made that completely silent.
describe('useAndroidPickedBooks with a duplicate-download marker', () => {
  test('forwards a book whose duplicate marker landed after the extension', async () => {
    const onPickedBooks = vi.fn();
    basenameMock.mockImplementation(async () => 'The_Amazing_Traveling.epub (1)');
    renderHook(() => useAndroidPickedBooks(makeAppService(true), onPickedBooks));

    await waitFor(() => expect(listeners).toHaveLength(1));
    await listeners[0]!.handler({ uris: ['content://downloads/1'] });

    await waitFor(() => expect(onPickedBooks).toHaveBeenCalled());
    expect(onPickedBooks.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ name: 'The_Amazing_Traveling.epub (1)' }),
    ]);
  });
});

describe('useAndroidPickedBooks with a mixed selection', () => {
  test('imports the books and still names the file it dropped', async () => {
    const onPickedBooks = vi.fn();
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue();
    basenameMock.mockImplementation(async (path: string) =>
      path.endsWith('/1') ? 'novel.epub' : 'resume.docx',
    );
    renderHook(() => useAndroidPickedBooks(makeAppService(true), onPickedBooks));

    await waitFor(() => expect(listeners).toHaveLength(1));
    await listeners[0]!.handler({ uris: ['content://downloads/1', 'content://downloads/2'] });

    await waitFor(() => expect(onPickedBooks).toHaveBeenCalled());
    expect(onPickedBooks.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ name: 'novel.epub' }),
    ]);
    expect(dispatchSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ message: expect.stringContaining('resume.docx') }),
    );
    dispatchSpy.mockRestore();
  });
});
