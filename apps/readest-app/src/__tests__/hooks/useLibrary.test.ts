import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ setSettings: vi.fn() }) }));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return {
    useLibraryStore: create(() => ({ library: [], libraryLoaded: true, setLibrary: vi.fn() })),
  };
});

import { useLibrary } from '@/hooks/useLibrary';
import { useLibraryStore } from '@/store/libraryStore';

describe('useLibrary', () => {
  // The reader hosts this hook, and every page turn writes the library (progress). A hook woken
  // by that re-renders the reader and everything under it.
  test('does not re-render when the library changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useLibrary();
    });
    const before = renders;
    act(() => useLibraryStore.setState({ library: [] }));
    expect(renders).toBe(before);
    expect(result.current.libraryLoaded).toBe(true);
  });
});
