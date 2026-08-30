import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BookNote } from '@/types/book';

const NOTION_SYNC_DEBOUNCE_MS = 5_000;

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (value: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (value: T) => R): R;
      getState: () => T;
    };
  };

  return {
    makeStore,
    appService: {},
    settings: {
      notion: {
        enabled: true,
        accessToken: 'secret_test',
        databaseId: '1234567890abcdef1234567890abcdef',
        lastSyncedAt: 1_900_000_000_000,
      },
    },
    config: {
      booknotes: [] as BookNote[],
    },
    setSettingsMock: vi.fn(),
    saveSettingsMock: vi.fn(async () => {}),
    syncBookNotesMock: vi.fn(),
    storeConstructorMock: vi.fn(),
    eventListeners: new Map<string, Set<(event: CustomEvent) => Promise<void> | void>>(),
    toasts: [] as Array<{ message: string; type: string }>,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => h.appService } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({
    settings: h.settings,
    setSettings: h.setSettingsMock,
    saveSettings: h.saveSettingsMock,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.config,
    getBookData: () => ({
      book: { hash: 'book-hash', title: 'Book title' },
      bookDoc: { toc: [] },
    }),
  }),
}));

vi.mock('@/services/notion', () => ({
  NotionClient: class {
    syncBookNotes(...args: unknown[]) {
      return h.syncBookNotesMock(...args);
    }
  },
  NotionSyncStore: class {
    constructor(appService: unknown) {
      h.storeConstructorMock(appService);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, listener: (event: CustomEvent) => Promise<void> | void) => {
      const listeners = h.eventListeners.get(name) ?? new Set();
      listeners.add(listener);
      h.eventListeners.set(name, listeners);
    },
    off: (name: string, listener: (event: CustomEvent) => Promise<void> | void) => {
      h.eventListeners.get(name)?.delete(listener);
    },
    dispatch: (name: string, detail: unknown) => {
      if (name === 'toast') h.toasts.push(detail as { message: string; type: string });
    },
  },
}));

import { useNotionSync } from '@/app/reader/hooks/useNotionSync';

const makeNote = (id: string, updatedAt: number): BookNote =>
  ({
    id,
    type: 'annotation',
    cfi: `epubcfi(/6/${id}!/4)`,
    text: id,
    note: '',
    createdAt: updatedAt,
    updatedAt,
  }) as BookNote;

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const advance = async (milliseconds: number) => {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await flushMicrotasks();
  });
};

const dispatch = async (name: string, detail: unknown) => {
  const event = new CustomEvent(name, { detail });
  for (const listener of h.eventListeners.get(name) ?? []) await listener(event);
};

beforeEach(() => {
  vi.useFakeTimers();
  h.config = { booknotes: [] };
  h.settings.notion = {
    enabled: true,
    accessToken: 'secret_test',
    databaseId: '1234567890abcdef1234567890abcdef',
    lastSyncedAt: 1_900_000_000_000,
  };
  h.syncBookNotesMock.mockReset().mockResolvedValue({
    success: true,
    inserted: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  });
  h.storeConstructorMock.mockClear();
  h.setSettingsMock.mockClear();
  h.saveSettingsMock.mockClear();
  h.eventListeners.clear();
  h.toasts.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useNotionSync', () => {
  test('passes every note to the per-note sync engine instead of filtering on a global cursor', async () => {
    h.config = { booknotes: [makeNote('1', 1_700_000_000_000)] };
    renderHook(() => useNotionSync('book-hash-view'));

    await advance(NOTION_SYNC_DEBOUNCE_MS);

    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);
    expect(h.syncBookNotesMock.mock.calls[0]![2]).toEqual(h.config.booknotes);
    expect(h.storeConstructorMock).toHaveBeenCalledWith(h.appService);
  });

  test('serializes a change that arrives while an earlier upload is in flight', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    h.syncBookNotesMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ success: true, inserted: 0, updated: 1, deleted: 0, skipped: 0 });
    h.config = { booknotes: [makeNote('1', 1_700_000_000_000)] };
    const { rerender } = renderHook(() => useNotionSync('book-hash-race'));
    await advance(NOTION_SYNC_DEBOUNCE_MS);

    h.config = {
      booknotes: [makeNote('1', 1_800_000_000_000), makeNote('2', 1_800_000_000_000)],
    };
    rerender();
    await advance(NOTION_SYNC_DEBOUNCE_MS);
    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({ success: true, inserted: 1, updated: 0, deleted: 0, skipped: 0 });
      await flushMicrotasks();
    });

    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(2);
    expect(h.syncBookNotesMock.mock.calls[1]![2]).toEqual(h.config.booknotes);
  });

  test('serializes syncs for different books that share the same OPFS database', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    h.syncBookNotesMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ success: true, inserted: 1, updated: 0, deleted: 0, skipped: 0 });
    h.config = { booknotes: [makeNote('1', 1_700_000_000_000)] };
    renderHook(() => useNotionSync('first-book'));
    renderHook(() => useNotionSync('second-book'));

    await advance(NOTION_SYNC_DEBOUNCE_MS);
    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({ success: true, inserted: 1, updated: 0, deleted: 0, skipped: 0 });
      await flushMicrotasks();
    });
    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(2);
  });

  test('waits for a pending note push before the reader closes', async () => {
    let resolveSync: ((value: unknown) => void) | undefined;
    h.syncBookNotesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );
    h.config = { booknotes: [makeNote('1', 1_700_000_000_000)] };
    renderHook(() => useNotionSync('book-hash-close'));

    let closed = false;
    const closePromise = dispatch('flush-notion-sync', { bookKey: 'book-hash-close' }).then(() => {
      closed = true;
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(h.syncBookNotesMock).toHaveBeenCalledTimes(1);
    expect(closed).toBe(false);
    resolveSync?.({ success: true, inserted: 1, updated: 0, deleted: 0, skipped: 0 });
    await act(async () => {
      await closePromise;
    });
    expect(closed).toBe(true);
  });
});
