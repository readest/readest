import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  // Zustand-like store mock: callable selector returning `state`, plus `.getState()`.
  const makeStore = <T,>(state: T) => {
    const fn = () => state;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as (() => T) & { getState: () => T };
  };

  const book = {
    hash: 'h1',
    format: 'PDF',
    metaHash: 'm1',
    updatedAt: 2000,
    progress: [5, 100] as [number, number],
  };
  const config = {
    progress: [5, 100] as [number, number],
    location: 'cfi-loc',
    updatedAt: 1000,
  };
  const libraryBook = { hash: 'h1', updatedAt: 2000, progress: [5, 100] as [number, number] };

  return {
    makeStore,
    book,
    config,
    libraryBook,
    user: { id: 'u1' },
    syncConfigsMock: vi.fn(async () => {}),
    syncBooksMock: vi.fn(async () => {}),
    state: { syncedConfigs: [] as unknown[] | null },
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    syncedConfigs: h.state.syncedConfigs,
    syncConfigs: h.syncConfigsMock,
    syncBooks: h.syncBooksMock,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.config,
    setConfig: vi.fn(),
    getBookData: () => ({ book: h.book }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getView: () => ({
      renderer: { getContents: () => [], primaryIndex: 0 },
      goTo: vi.fn(),
    }),
    getProgress: () => ({ location: 'cfi-loc' }),
    setHoveredBookKey: vi.fn(),
    getViewState: () => ({ previewMode: false }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({ settings: { globalViewSettings: {} } }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: h.makeStore({ library: [h.libraryBook] }),
}));

vi.mock('@/utils/serializer', () => ({
  serializeConfig: () => JSON.stringify({ progress: [5, 100], location: 'cfi-loc' }),
}));

vi.mock('@/utils/xcfi', () => ({
  getCFIFromXPointer: vi.fn(async () => ''),
  getXPointerFromCFI: vi.fn(async () => ({ xpointer: '' })),
}));

vi.mock('@/libs/document', () => ({
  CFI: { compare: () => 0 },
}));

import { useProgressSync } from '@/app/reader/hooks/useProgressSync';
import { SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';

const flushAutoSync = async () => {
  await act(async () => {
    vi.advanceTimersByTime(SYNC_PROGRESS_INTERVAL_SEC * 1000 + 100);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.syncConfigsMock.mockClear();
  h.syncBooksMock.mockClear();
  h.state.syncedConfigs = [];
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useProgressSync', () => {
  test('auto-sync push also pushes the books row so other devices see fresh progress', async () => {
    renderHook(() => useProgressSync('h1-view1'));
    await flushAutoSync();

    // configs lane still pushed
    expect(h.syncConfigsMock).toHaveBeenCalledWith(expect.any(Array), 'h1', 'm1', 'push');
    // books lane also pushed with the in-memory library Book
    expect(h.syncBooksMock).toHaveBeenCalledWith([h.libraryBook], 'push');
  });
});
