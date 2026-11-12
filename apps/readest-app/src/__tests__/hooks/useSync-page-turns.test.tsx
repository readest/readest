// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BookData, useBookDataStore } from '@/store/bookDataStore';
import type { BookConfig } from '@/types/book';

// useSync runs inside FoliateViewer (useProgressSync) and Annotator (useNotesSync). Every page turn
// writes the book's location into bookDataStore and the progress save after it stamps the config
// again; a hook that follows the whole store re-renders both on each.

const settingsState = vi.hoisted(() => ({
  settings: { version: 1 },
  setSettings: () => {},
  saveSettings: async () => {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/context/SyncContext', () => ({ useSyncContext: () => ({ syncClient: {} }) }));
vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => settingsState;
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});
vi.mock('@/store/readerStore', () => {
  const state = { setIsSyncing: () => {} };
  return {
    useReaderStore: (select?: (s: typeof state) => unknown) => (select ? select(state) : state),
  };
});

const { useSync } = await import('@/hooks/useSync');

const writeConfig = (config: Partial<BookConfig>) =>
  useBookDataStore.setState((s) => ({
    booksData: {
      ...s.booksData,
      h1: { id: 'h1', config: { ...s.booksData['h1']?.config, ...config } } as BookData,
    },
  }));

afterEach(() => {
  cleanup();
  useBookDataStore.setState({ booksData: {} });
});

describe('useSync while reading', () => {
  it('does not re-render on the page turns and progress saves after its first sync is set up', () => {
    writeConfig({ location: 'a', progress: [1, 100] });
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useSync('h1-key');
    });
    expect(result.current.useSyncInited).toBe(true);
    const settled = renders;

    // a page turn writes the location; the progress save then stamps updatedAt
    act(() => writeConfig({ location: 'b', progress: [2, 100] }));
    act(() => writeConfig({ updatedAt: 1 }));

    expect(renders).toBe(settled);
  });

  it('sets up its first sync once a newly opened book gets a location', () => {
    writeConfig({ progress: [0, 0] });
    const { result } = renderHook(() => useSync('h1-key'));
    expect(result.current.useSyncInited).toBe(false);

    act(() => writeConfig({ location: 'a', progress: [1, 100] }));

    expect(result.current.useSyncInited).toBe(true);
  });
});
