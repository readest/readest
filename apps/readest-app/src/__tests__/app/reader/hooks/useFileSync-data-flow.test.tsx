import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFlowState } from '@/services/sync/dataFlow/log';

const h = vi.hoisted(() => {
  const settings = { webdav: { enabled: true, serverUrl: 'https://dav', strategy: 'silent' } };
  const book = { hash: 'h1', title: 'Dune', format: 'EPUB' };
  const config = { booknotes: [], location: 'epubcfi(/6/4)' };
  const data = {
    getConfig: () => config,
    setConfig: vi.fn(),
    getBookData: () => ({ book }),
    saveConfig: vi.fn(async () => {}),
  };
  const store = { settings, setSettings: vi.fn(), saveSettings: vi.fn(async () => {}) };
  return {
    env: { appService: {}, envConfig: {} },
    translate: (s: string) => s,
    data,
    store,
    pushBookConfig: vi.fn(),
    pullBookConfig: vi.fn(),
    pushBookFile: vi.fn(),
    pushBookCover: vi.fn(),
  };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => h.env }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => h.translate }));
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => ({ userProfilePlan: 'pro' }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: typeof h.data) => unknown) => selector(h.data),
}));
vi.mock('@/store/readerStore', () => {
  const state = {
    getViewsById: () => [],
    getView: () => null,
    getViewState: () => ({ previewMode: false }),
  };
  return {
    useReaderStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: 'epubcfi(/6/4)' }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => h.store, { getState: () => h.store }),
}));
vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: vi.fn(async () => ({})),
}));
vi.mock('@/services/sync/file/appLocalStore', () => ({ createAppLocalStore: () => ({}) }));
vi.mock('@/services/sync/file/runLibrarySync', () => ({ canBackendRun: () => true }));
vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: class {
    pushBookConfig = h.pushBookConfig;
    pullBookConfig = h.pullBookConfig;
    pushBookFile = h.pushBookFile;
    pushBookCover = h.pushBookCover;
  },
}));
vi.mock('@/app/reader/hooks/useWindowActiveChanged', () => ({ useWindowActiveChanged: () => {} }));

import { useFileSync } from '@/app/reader/hooks/useFileSync';

describe('useFileSync data flow', () => {
  beforeEach(() => {
    localStorage.clear();
    h.pushBookConfig.mockReset().mockResolvedValue(undefined);
    h.pullBookConfig.mockReset().mockResolvedValue({ applied: false });
    h.pushBookFile.mockReset().mockResolvedValue({ uploaded: false });
    h.pushBookCover.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('records the config it pushed under its backend', async () => {
    renderHook(() => useFileSync('k'));

    await waitFor(() => expect(h.pushBookConfig).toHaveBeenCalled());
    await waitFor(() =>
      expect(readFlowState().entries[0]).toMatchObject({
        connector: 'webdav',
        direction: 'push',
        kind: 'progress',
        count: 1,
        bookTitle: 'Dune',
      }),
    );
  });

  test('records a pull that applied a newer config', async () => {
    h.pullBookConfig.mockResolvedValue({ applied: true, mergedConfig: {} });
    renderHook(() => useFileSync('k'));

    await waitFor(() =>
      expect(readFlowState().entries.find((e) => e.direction === 'pull')).toMatchObject({
        connector: 'webdav',
        count: 1,
      }),
    );
  });

  test('records a failed pull', async () => {
    h.pullBookConfig.mockRejectedValue(new Error('403 Forbidden'));
    renderHook(() => useFileSync('k'));

    await waitFor(() =>
      expect(readFlowState().entries.find((e) => e.direction === 'pull')).toMatchObject({
        error: '403 Forbidden',
      }),
    );
  });

  test('records a failed push', async () => {
    h.pushBookConfig.mockRejectedValue(new Error('507 Insufficient Storage'));
    renderHook(() => useFileSync('k'));

    await waitFor(() =>
      expect(readFlowState().entries.find((e) => e.error)).toMatchObject({
        direction: 'push',
        error: '507 Insufficient Storage',
      }),
    );
  });
});
