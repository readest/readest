import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const {
  subscribeMock,
  setStatusMock,
  extractMock,
  ingestMock,
  updateBooksMock,
  dispatchMock,
  isTauriAppPlatformMock,
} = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  setStatusMock: vi.fn(),
  extractMock: vi.fn(),
  ingestMock: vi.fn(),
  updateBooksMock: vi.fn(),
  dispatchMock: vi.fn(),
  isTauriAppPlatformMock: vi.fn(),
}));

vi.mock('@/services/webBrowser/webBrowser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/webBrowser/webBrowser')>();
  return {
    ...actual,
    subscribeWebBrowserDownloads: subscribeMock,
    setWebBrowserStatus: setStatusMock,
    extractWebBrowserArchive: extractMock,
  };
});
vi.mock('@/services/ingestService', () => ({ ingestFile: ingestMock }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: isTauriAppPlatformMock }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: dispatchMock } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => 'g1' }) }));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: [{ hash: 'x', groupId: 'g1', groupName: 'Sci-fi' }],
      updateBooks: updateBooksMock,
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));

import { useWebBrowserDownloads } from '@/hooks/useWebBrowserDownloads';

type Handler = (d: {
  url: string;
  path: string;
  filename: string;
  success: boolean;
  error?: string;
}) => void;

beforeEach(() => {
  subscribeMock.mockReset();
  setStatusMock.mockReset().mockResolvedValue(undefined);
  extractMock.mockReset().mockResolvedValue([]);
  ingestMock.mockReset();
  updateBooksMock.mockReset().mockResolvedValue(undefined);
  dispatchMock.mockReset();
  isTauriAppPlatformMock.mockReset().mockReturnValue(true);
});

async function mountAndGetHandler(): Promise<Handler> {
  let handler: Handler | null = null;
  subscribeMock.mockImplementation((_mobile: boolean, cb: Handler) => {
    handler = cb;
    return Promise.resolve(() => {});
  });
  renderHook(() => useWebBrowserDownloads());
  await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
  return handler!;
}

describe('useWebBrowserDownloads', () => {
  it('does not subscribe to Tauri download events in the web app', () => {
    isTauriAppPlatformMock.mockReturnValue(false);
    subscribeMock.mockResolvedValue(() => {});

    renderHook(() => useWebBrowserDownloads());

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('imports a supported download into the current group and reports added', async () => {
    ingestMock.mockResolvedValue({ hash: 'h1', title: 'Dune' });
    const handler = await mountAndGetHandler();
    handler({ url: 'u', path: '/cache/dune.epub', filename: 'dune.epub', success: true });
    await waitFor(() => expect(updateBooksMock).toHaveBeenCalled());
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/cache/dune.epub', groupId: 'g1', groupName: 'Sci-fi' }),
      expect.objectContaining({ isLoggedIn: false }),
    );
    expect(setStatusMock).toHaveBeenNthCalledWith(1, {
      state: 'importing',
      filename: 'dune.epub',
    });
    expect(setStatusMock).toHaveBeenLastCalledWith({
      state: 'added',
      filename: 'dune.epub',
      bookHash: 'h1',
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'success' }),
    );
  });

  // Audiobookshelf serves every folder item as `<title>.zip` (#6256).
  it('imports the books unpacked from a downloaded zip archive', async () => {
    extractMock.mockResolvedValue(['/cache/Dune.epub', '/cache/Dune Maps.pdf']);
    ingestMock
      .mockResolvedValueOnce({ hash: 'h1', title: 'Dune' })
      .mockResolvedValueOnce({ hash: 'h2', title: 'Dune Maps' });
    const handler = await mountAndGetHandler();
    handler({ url: 'u', path: '/cache/Dune.zip', filename: 'Dune.zip', success: true });
    await waitFor(() => expect(updateBooksMock).toHaveBeenCalledTimes(2));
    expect(extractMock).toHaveBeenCalledWith('/cache/Dune.zip');
    expect(ingestMock.mock.calls.map(([opts]) => opts.file)).toEqual([
      '/cache/Dune.epub',
      '/cache/Dune Maps.pdf',
    ]);
    expect(setStatusMock).toHaveBeenLastCalledWith({
      state: 'added',
      filename: 'Dune.zip',
      bookHash: 'h2',
    });
  });

  it('imports a zip that holds no separate books as a book itself', async () => {
    ingestMock.mockResolvedValue({ hash: 'h1', title: 'Dune' });
    const handler = await mountAndGetHandler();
    handler({ url: 'u', path: '/cache/dune.zip', filename: 'dune.zip', success: true });
    await waitFor(() => expect(updateBooksMock).toHaveBeenCalled());
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/cache/dune.zip' }),
      expect.anything(),
    );

    handler({ url: 'u2', path: '/cache/dune.fb2.zip', filename: 'dune.fb2.zip', success: true });
    await waitFor(() => expect(updateBooksMock).toHaveBeenCalledTimes(2));
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported files without importing them', async () => {
    const handler = await mountAndGetHandler();
    handler({ url: 'u', path: '/cache/cover.jpg', filename: 'cover.jpg', success: true });
    await waitFor(() =>
      expect(setStatusMock).toHaveBeenCalledWith({ state: 'unsupported', filename: 'cover.jpg' }),
    );
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('reports failed downloads and failed imports', async () => {
    const handler = await mountAndGetHandler();
    handler({
      url: 'u',
      path: '/cache/dune.epub',
      filename: 'dune.epub',
      success: false,
      error: 'boom',
    });
    await waitFor(() =>
      expect(setStatusMock).toHaveBeenCalledWith({ state: 'failed', filename: 'dune.epub' }),
    );
    expect(dispatchMock).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' }));

    ingestMock.mockRejectedValue(new Error('bad epub'));
    handler({ url: 'u2', path: '/cache/bad.epub', filename: 'bad.epub', success: true });
    await waitFor(() =>
      expect(setStatusMock).toHaveBeenCalledWith({ state: 'failed', filename: 'bad.epub' }),
    );
  });
});
