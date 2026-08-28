import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BookNote } from '@/types/book';
import { NOTEBOOK_ID } from '@/app/reader/utils/notebookDocument';
import {
  getNotebookContentHash,
  getNotebookRecoveryKey,
  readNotebookRecovery,
} from '@/app/reader/utils/notebookRecovery';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { createNotebookDocumentCoordinator } from '@/app/reader/services/notebookDocumentCoordinator';
import { canTransitionWithNotebookRecovery } from '@/app/reader/services/notebookDocumentCoordinator';

const makeNotebook = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: NOTEBOOK_ID,
  type: 'notebook',
  cfi: 'epubcfi(/6/2)',
  note: 'saved',
  createdAt: 50,
  updatedAt: 100,
  ...overrides,
});

describe('NotebookDocumentCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useNotebookDocumentStore.getState().reset();
  });

  afterEach(() => vi.useRealTimers());

  const setup = ({
    initialBooknotes = [makeNotebook()],
    compatibilityCfi = 'epubcfi(/6/2)',
    persist,
  }: {
    initialBooknotes?: BookNote[];
    compatibilityCfi?: string | null;
    persist?: (booknotes: BookNote[]) => Promise<void>;
  } = {}) => {
    let booknotes = initialBooknotes;
    const persistBooknotes = vi.fn(
      persist ??
        (async (nextBooknotes: BookNote[]) => {
          booknotes = nextBooknotes;
        }),
    );
    const recoveryKey = getNotebookRecoveryKey('profile', 'book');
    const coordinator = createNotebookDocumentCoordinator({
      bookHash: 'book',
      getBooknotes: () => booknotes,
      getCompatibilityCfi: () => compatibilityCfi,
      persistBooknotes,
      storage: localStorage,
      recoveryKey,
      now: () => 500,
    });
    coordinator.start();
    return { coordinator, persistBooknotes, recoveryKey, getBooknotes: () => booknotes };
  };

  it('hydrates the durable Notebook without creating a new record', () => {
    const { coordinator, persistBooknotes } = setup();

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'saved',
      durableContent: 'saved',
      durableUpdatedAt: 100,
      status: 'clean',
    });
    expect(persistBooknotes).not.toHaveBeenCalled();
    coordinator.stop();
  });

  it('writes recovery synchronously and saves once after 750 ms idle', async () => {
    const { coordinator, persistBooknotes, recoveryKey } = setup();

    useNotebookDocumentStore.getState().mutate('book', 'draft');
    expect(readNotebookRecovery(localStorage, recoveryKey)?.content).toBe('draft');
    await vi.advanceTimersByTimeAsync(749);
    expect(persistBooknotes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(persistBooknotes).toHaveBeenCalledTimes(1);
    expect(persistBooknotes.mock.calls[0]?.[0]).toContainEqual(
      expect.objectContaining({ id: NOTEBOOK_ID, note: 'draft', updatedAt: 500 }),
    );
    expect(useNotebookDocumentStore.getState().sessions['book']?.status).toBe('clean');
    expect(readNotebookRecovery(localStorage, recoveryKey)).toBeNull();
    coordinator.stop();
  });

  it('serializes a newer edit behind an in-flight save', async () => {
    let resolveFirst: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let calls = 0;
    const persist = vi.fn(async (_booknotes: BookNote[]) => {
      calls += 1;
      if (calls === 1) await firstSave;
    });
    const { coordinator } = setup({ persist });

    useNotebookDocumentStore.getState().mutate('book', 'first');
    const flushPromise = coordinator.flush();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    useNotebookDocumentStore.getState().mutate('book', 'second');
    resolveFirst?.();
    await flushPromise;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1]?.[0]).toContainEqual(
      expect.objectContaining({ id: NOTEBOOK_ID, note: 'second' }),
    );
    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'second',
      savedRevision: 2,
      status: 'clean',
    });
    coordinator.stop();
  });

  it('keeps recovery and reports failure when persistence rejects', async () => {
    const { coordinator, recoveryKey } = setup({
      persist: async () => {
        throw new Error('disk failed');
      },
    });
    useNotebookDocumentStore.getState().mutate('book', 'draft');

    await expect(coordinator.flush()).resolves.toBe('failed');

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'draft',
      status: 'error',
      error: 'save-failed',
    });
    expect(readNotebookRecovery(localStorage, recoveryKey)?.content).toBe('draft');
    coordinator.stop();
  });

  it('blocks transitions only when a dirty draft has no recovery path', async () => {
    const failingStorage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException('blocked');
      },
    };
    const recoveryKey = getNotebookRecoveryKey('profile', 'book');
    const coordinator = createNotebookDocumentCoordinator({
      bookHash: 'book',
      getBooknotes: () => [makeNotebook()],
      getCompatibilityCfi: () => 'epubcfi(/6/2)',
      persistBooknotes: async () => {
        throw new Error('disk failed');
      },
      storage: failingStorage,
      recoveryKey,
    });
    coordinator.start();
    useNotebookDocumentStore.getState().mutate('book', 'draft');

    await expect(coordinator.flush()).resolves.toBe('failed');
    expect(useNotebookDocumentStore.getState().sessions['book']?.recoveryAvailable).toBe(false);
    expect(canTransitionWithNotebookRecovery('book')).toBe(false);

    useNotebookDocumentStore.getState().discardDraft('book');
    expect(canTransitionWithNotebookRecovery('book')).toBe(true);
    coordinator.stop();
  });

  it('waits for a valid position instead of creating an unanchored record', async () => {
    const { coordinator, persistBooknotes } = setup({
      initialBooknotes: [],
      compatibilityCfi: null,
    });
    useNotebookDocumentStore.getState().mutate('book', 'draft');

    await expect(coordinator.flush()).resolves.toBe('waiting-for-position');

    expect(persistBooknotes).not.toHaveBeenCalled();
    expect(useNotebookDocumentStore.getState().sessions['book']?.status).toBe(
      'waiting-for-position',
    );
    coordinator.stop();
  });

  it('restores an unacknowledged draft when its durable base still matches', () => {
    const recoveryKey = getNotebookRecoveryKey('profile', 'book');
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        content: 'recovered draft',
        baseHash: getNotebookContentHash('saved'),
        baseUpdatedAt: 100,
        revision: 7,
      }),
    );
    const coordinator = createNotebookDocumentCoordinator({
      bookHash: 'book',
      getBooknotes: () => [makeNotebook()],
      getCompatibilityCfi: () => 'epubcfi(/6/2)',
      persistBooknotes: async () => undefined,
      storage: localStorage,
      recoveryKey,
      now: () => 500,
    });

    coordinator.start();

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'recovered draft',
      status: 'dirty',
      hasEdited: true,
    });
    coordinator.stop();
  });
});
