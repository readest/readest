// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  return { useSettingsStore: create(() => ({ setSettings: vi.fn() })) };
});
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return {
    useLibraryStore: create(() => ({ library: [], libraryLoaded: true, setLibrary: vi.fn() })),
  };
});

import { useLibrary } from '@/hooks/useLibrary';
import { useLibraryStore } from '@/store/libraryStore';

afterEach(cleanup);

describe('useLibrary subscriptions', () => {
  // The reader calls this hook; the library changes on every page turn (the book's progress)
  test('a library change does not re-render the component using it', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useLibrary();
    });
    expect(result.current.libraryLoaded).toBe(true);
    const before = renders;
    act(() => useLibraryStore.setState({ library: [] }));
    expect(renders).toBe(before);
  });
});
