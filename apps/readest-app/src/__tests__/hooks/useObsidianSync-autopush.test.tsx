// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ syncBookToVault: vi.fn(async () => 1) }));

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({}) } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/settingsStore', () => {
  const state = { settings: { obsidian: { enabled: true, folder: '/vault' } } };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/services/obsidian/vaultSync', () => ({
  syncBookToVault: h.syncBookToVault,
  toVaultHighlights: () => [],
}));

import { useObsidianSync } from '@/app/reader/hooks/useObsidianSync';
import { useBookDataStore } from '@/store/bookDataStore';
import type { Book, BookConfig, BookNote } from '@/types/book';

const note = (id: string) => ({ id, type: 'annotation', cfi: 'c', text: id }) as BookNote;

const setBooknotes = (booknotes: BookNote[]) =>
  act(() =>
    useBookDataStore.setState((state) => ({
      booksData: {
        ...state.booksData,
        h1: { ...state.booksData['h1']!, config: { ...state.booksData['h1']!.config!, booknotes } },
      },
    })),
  );

beforeEach(() => {
  vi.useFakeTimers();
  h.syncBookToVault.mockClear();
  useBookDataStore.setState({
    booksData: {
      h1: {
        id: 'h1',
        book: { hash: 'h1', title: 'Book' } as Book,
        file: null,
        config: { booknotes: [note('a')] } as unknown as BookConfig,
        bookDoc: null,
        isFixedLayout: false,
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useObsidianSync auto-push', () => {
  test('pushes a highlight added after the book opened, with nothing else re-rendering', async () => {
    renderHook(() => useObsidianSync('h1'));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(h.syncBookToVault).toHaveBeenCalledTimes(1);

    setBooknotes([note('a'), note('b')]);
    await act(() => vi.advanceTimersByTimeAsync(6000));

    expect(h.syncBookToVault).toHaveBeenCalledTimes(2);
  });
});
