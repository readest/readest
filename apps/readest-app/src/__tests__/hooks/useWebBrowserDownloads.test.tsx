import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { subscribeMock, setStatusMock, ingestMock, updateBooksMock, dispatchMock } = vi.hoisted(
  () => ({
    subscribeMock: vi.fn(),
    setStatusMock: vi.fn(),
    ingestMock: vi.fn(),
    updateBooksMock: vi.fn(),
    dispatchMock: vi.fn(),
  }),
);

vi.mock('@/services/webBrowser/webBrowser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/webBrowser/webBrowser')>();
  return {
    ...actual,
    subscribeWebBrowserDownloads: subscribeMock,
    setWebBrowserStatus: setStatusMock,
  };
});
vi.mock('@/services/ingestService', () => ({ ingestFile: ingestMock }));
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
  ingestMock.mockReset();
  updateBooksMock.mockReset().mockResolvedValue(undefined);
  dispatchMock.mockReset();
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
