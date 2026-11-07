import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import { saveBookshelfGroupChanges } from '@/services/bookshelves/groupChanges';
import { readBookshelves } from '@/services/bookshelves/state';
import { setBookGroup } from '@/utils/book';
import { md5Fingerprint } from '@/utils/md5';

const original: Book = {
  hash: 'one',
  title: 'One',
  author: 'Writer',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [1, 10],
  groupName: 'A/B',
  groupId: md5Fingerprint('A/B'),
  groupUpdatedAt: 1,
};
const save = vi.fn<(books: Book[]) => Promise<void>>();
const env = {} as EnvConfigType;
env.getAppService = vi.fn().mockResolvedValue({ saveLibraryBooks: save });
const originalSave = useSettingsStore.getState().saveSettings;
let base: BookshelfDefinition[];
let draft: BookshelfDefinition[];
let changed: Book;
beforeEach(async () => {
  localStorage.clear();
  save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings,
    saveSettings: vi.fn(async () => {}),
  });
  useLibraryStore.getState().setLibrary([{ ...original }]);
  const initial = readBookshelves(useSettingsStore.getState().settings);
  await saveBookshelfDraft(
    env,
    initial,
    initial.map((s) =>
      s.id === 'default'
        ? {
            ...s,
            manualOrder: { 'group:A/B': ['b:one'] },
          }
        : s,
    ),
  );
  base = readBookshelves(useSettingsStore.getState().settings);
  draft = base.map((s) =>
    s.id === 'default'
      ? {
          ...s,
          manualOrder: { 'group:A/B': [], 'group:B': ['b:one'] },
        }
      : s,
  );
  changed = { ...original };
  setBookGroup(changed, md5Fingerprint('B'), 'B');
});
afterEach(() => {
  useSettingsStore.setState({ saveSettings: originalSave });
  localStorage.clear();
});

describe('saving group membership and shelf order together', () => {
  it('retains concurrent deletion tombstones and imported books in the persisted retry', async () => {
    const pending = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let persisted: Book[] = [];
    save.mockImplementation(async (updates) => {
      persisted = updates;
    });
    save.mockImplementationOnce(async (updates) => {
      started.resolve();
      await pending.promise;
      persisted = updates;
    });
    const running = saveBookshelfGroupChanges(env, base, draft, [changed]);
    await started.promise;
    const tombstone = { ...original, deletedAt: 900 };
    const imported = { ...original, hash: 'imported', title: 'Imported' };
    useLibraryStore.getState().setLibrary([tombstone, imported]);
    pending.resolve();
    await running;
    expect(persisted.find((book) => book.hash === original.hash)?.deletedAt).toBe(900);
    expect(persisted).toContainEqual(imported);
    expect(useLibraryStore.getState().library).toEqual([tombstone, imported]);
  });
  it('never publishes a failed membership edit to automatic sync', async () => {
    const pending = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    save.mockImplementationOnce(async () => {
      started.resolve();
      await pending.promise;
    });
    const published: string[] = [];
    const unsubscribe = useLibraryStore.subscribe((state) =>
      published.push(state.library[0]?.groupName ?? ''),
    );
    try {
      const running = saveBookshelfGroupChanges(env, base, draft, [changed]);
      const rejected = expect(running).rejects.toThrow('disk unavailable');
      await started.promise;
      expect(useLibraryStore.getState().library[0]?.groupName).toBe('A/B');
      pending.reject(new Error('disk unavailable'));
      await rejected;
      expect(published.every((name) => name === 'A/B')).toBe(true);
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
          ?.manualOrder?.['group:A/B'],
      ).toEqual(['b:one']);
    } finally {
      unsubscribe();
    }
  });

  it('saves the latest reading progress when it changes during the library write', async () => {
    const pending = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    save.mockImplementationOnce(async () => {
      started.resolve();
      await pending.promise;
    });
    const running = saveBookshelfGroupChanges(env, base, draft, [changed]);
    await started.promise;
    useLibraryStore.getState().setLibrary([{ ...original, progress: [8, 10], updatedAt: 900 }]);
    pending.resolve();
    await running;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.lastCall?.[0][0]).toMatchObject({
      groupName: 'B',
      progress: [8, 10],
      updatedAt: 900,
    });
    expect(useLibraryStore.getState().library[0]).toMatchObject({
      groupName: 'B',
      progress: [8, 10],
      updatedAt: 900,
    });
  });

  it('keeps a committed membership and its order when a later progress retry fails', async () => {
    let persisted = { ...original };
    save
      .mockImplementationOnce(async (updates) => {
        persisted = { ...updates[0]! };
        useLibraryStore.getState().setLibrary([{ ...original, progress: [8, 10], updatedAt: 900 }]);
      })
      .mockRejectedValueOnce(new Error('retry unavailable'));
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'retry unavailable',
    );
    expect(useLibraryStore.getState().library[0]).toMatchObject({
      groupName: persisted.groupName,
      progress: [8, 10],
    });
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
        ?.manualOrder?.['group:B'],
    ).toEqual(['b:one']);
  });
});
