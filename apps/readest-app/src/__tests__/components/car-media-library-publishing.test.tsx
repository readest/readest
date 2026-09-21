import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarMediaLibraryBridge from '@/components/CarMediaLibraryBridge';
import { useAppLockStore } from '@/store/appLockStore';
import { useLibraryStore } from '@/store/libraryStore';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: mocks.listen,
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  getInitializedAppService: () => null,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => mocks.platform,
}));
vi.mock('@/utils/window', () => ({ isMainAppWindow: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  useAppLockStore.setState({ isInitialized: true, isUnlocked: true });
  useLibraryStore.setState({
    libraryLoaded: true,
    library: [
      {
        hash: 'book',
        title: 'Book',
        author: 'Author',
        format: 'EPUB',
        createdAt: 1,
        updatedAt: 1,
        downloadedAt: 1,
      },
    ],
    coverThumbnails: new Map(),
  });
});
afterEach(cleanup);

describe.each(['ios', 'android'])('car library on %s', (platform) => {
  it('publishes playable books and clears the persisted list when locked', async () => {
    mocks.platform = platform;
    render(<CarMediaLibraryBridge />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('plugin:native-tts|update_media_library', {
        payload: { booksJson: expect.stringContaining('"hash":"book"') },
      }),
    );
    act(() => useAppLockStore.setState({ isUnlocked: false }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('plugin:native-tts|update_media_library', {
        payload: { booksJson: '[]' },
      }),
    );
  });
});
