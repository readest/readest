import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  appService: {
    isIOSApp: true,
    hasWindow: false,
    loadSettings: vi.fn(async () => ({ autoImportBooksOnOpen: true })),
  },
  navigateToLibrary: vi.fn(),
  setCheckOpenWithBooks: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ setCheckOpenWithBooks: h.setCheckOpenWithBooks }),
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: h.navigateToLibrary,
  navigateToReader: vi.fn(),
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/md5', () => ({ partialMD5: vi.fn() }));

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { eventDispatcher } from '@/utils/event';

afterEach(() => {
  cleanup();
  delete window.OPEN_WITH_FILES;
  vi.clearAllMocks();
});

describe('useOpenWithBooks iOS file URL ingress', () => {
  test.each([
    'A%23B.epub',
    '100%25.epub',
    'Report%2520Final.epub',
    '%E4%B8%89%E4%BD%93%20book.epub',
  ])('preserves the raw iOS URL for %s', async (basename) => {
    const uri = `file:///private/var/Inbox/${basename}`;
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri] });
    });
    await waitFor(() => expect(h.navigateToLibrary).toHaveBeenCalledTimes(1));
    expect(window.OPEN_WITH_FILES).toEqual([uri]);
    expect(h.setCheckOpenWithBooks).toHaveBeenCalledWith(true);
  });
});
