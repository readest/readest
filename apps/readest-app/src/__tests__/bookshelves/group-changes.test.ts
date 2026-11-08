import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import {
  recoverBookshelfGroupChanges,
  saveBookshelfGroupChanges,
} from '@/services/bookshelves/groupChanges';
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
const groupJournalKeys = () =>
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(
    (key) => key.startsWith('readest.bookshelf.group-change.v1:'),
  );
const snapshot = () => ({
  settings: JSON.parse(JSON.stringify(useSettingsStore.getState().settings)) as SystemSettings,
  entries: Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index)!;
    return [key, localStorage.getItem(key)!] as const;
  }),
});
const restart = (saved: ReturnType<typeof snapshot>) => {
  localStorage.clear();
  saved.entries.forEach(([key, value]) => localStorage.setItem(key, value));
  useSettingsStore.setState({ settings: saved.settings });
  useLibraryStore.getState().setLibrary([]);
  useLibraryStore.setState({ libraryLoaded: false });
};
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
      expect(save).toHaveBeenCalledWith(expect.any(Array), { throwOnFailure: true });
      expect(groupJournalKeys()).toEqual([]);
      expect(published.every((name) => name === 'A/B')).toBe(true);
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
          ?.manualOrder?.['group:A/B'],
      ).toEqual(['b:one']);
      expect(
        readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
          ?.manualOrderUpdatedAt?.['group:A/B'],
      ).toBe(base.find((s) => s.id === 'default')?.manualOrderUpdatedAt?.['group:A/B']);
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

  it('returns the full disk library unchanged when no move is pending, even with a partial seeded store', async () => {
    const books = [{ ...original }, { ...original, hash: 'other' }];
    useLibraryStore.getState().setLibrary([original]);
    expect(await recoverBookshelfGroupChanges(env, books)).toBe(books);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('recovers both sides after termination at the library-write boundary (membership written: %s)', async (written) => {
    let persisted = [{ ...original }];
    let interrupted: ReturnType<typeof snapshot> | undefined;
    save.mockImplementationOnce(async (books) => {
      if (written) persisted = structuredClone(books);
      interrupted = snapshot();
      throw new Error('process terminated');
    });
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'process terminated',
    );
    // Discard the graceful catch/rollback and reload the durable state as it
    // stood at process termination, before any recovery code could run.
    restart(interrupted!);
    const imported = { ...original, hash: 'imported' };
    const deleted = { ...original, hash: 'deleted', deletedAt: 900 };
    const books = [
      { ...persisted[0]!, progress: [8, 10] as [number, number], updatedAt: 900 },
      imported,
      deleted,
    ];
    const recovered = await recoverBookshelfGroupChanges(env, books);
    expect(recovered[0]).toMatchObject({ groupName: 'B', progress: [8, 10], updatedAt: 900 });
    expect(recovered).toContainEqual(imported);
    expect(recovered).toContainEqual(deleted);
    expect(save.mock.lastCall?.[0]).toEqual(recovered);
    expect(useLibraryStore.getState().library).toEqual([]);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
        ?.manualOrder?.['group:B'],
    ).toEqual(['b:one']);
    expect(groupJournalKeys()).toEqual([]);
    const writes = save.mock.calls.length;
    expect(await recoverBookshelfGroupChanges(env, recovered)).toBe(recovered);
    expect(save).toHaveBeenCalledTimes(writes);
  });

  it('retains a newer same-order rearrangement baseline and independent scopes during recovery', async () => {
    let interrupted: ReturnType<typeof snapshot> | undefined;
    save.mockImplementationOnce(async () => {
      interrupted = snapshot();
      throw new Error('process terminated');
    });
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'process terminated',
    );
    restart(interrupted!);
    const current = readBookshelves(useSettingsStore.getState().settings);
    const time = current.find((s) => s.id === 'default')!.manualOrderUpdatedAt!['group:B']! + 1000;
    await saveBookshelfDraft(
      env,
      current,
      current.map((s) =>
        s.id === 'default'
          ? {
              ...s,
              manualOrder: { ...s.manualOrder, 'group:independent': ['b:other'] },
            }
          : s,
      ),
    );
    // The same IDs with a newer baseline arrive from another explicit reorder.
    // Item-order rows, not shelf definitions, own that baseline.
    const rows = useSettingsStore.getState().settings.bookshelves!.rows;
    for (const row of Object.values(rows)) {
      const value = row.fields_jsonb['itemOrder']?.v as
        | { scope?: string; orderedAt?: number }
        | undefined;
      if (value?.scope === 'group:B') value.orderedAt = time;
    }
    await recoverBookshelfGroupChanges(env, [original]);
    const recovered = readBookshelves(useSettingsStore.getState().settings).find(
      (s) => s.id === 'default',
    )!;
    expect(recovered.manualOrderUpdatedAt?.['group:B']).toBe(time);
    expect(recovered.manualOrder?.['group:independent']).toEqual(['b:other']);
  });

  it('waits for a live move instead of replaying its unfinished journal on a remount', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    save.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const running = saveBookshelfGroupChanges(env, base, draft, [changed]);
    await started.promise;
    const recovering = recoverBookshelfGroupChanges(env, [original]);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    release.resolve();
    await running;
    const recovered = await recovering;
    expect(recovered[0]?.groupName).toBe('B');
    expect(save).toHaveBeenCalledTimes(1);
    expect(groupJournalKeys()).toEqual([]);
  });

  it('leaves another account’s pending move untouched and allows its owner to recover later', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'owner' }));
    let interrupted: ReturnType<typeof snapshot> | undefined;
    save.mockImplementationOnce(async () => {
      interrupted = snapshot();
      throw new Error('process terminated');
    });
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'process terminated',
    );
    restart(interrupted!);
    localStorage.setItem('user', JSON.stringify({ id: 'other-account' }));
    const disk = [original];
    const writes = save.mock.calls.length;
    expect(await recoverBookshelfGroupChanges(env, disk)).toBe(disk);
    expect(save).toHaveBeenCalledTimes(writes);
    expect(groupJournalKeys()).toHaveLength(1);
    localStorage.setItem('user', JSON.stringify({ id: 'owner' }));
    expect((await recoverBookshelfGroupChanges(env, disk))[0]?.groupName).toBe('B');
    expect(groupJournalKeys()).toEqual([]);
  });

  it('recovers an anonymous pending move after signing in without waiting for sync', async () => {
    let interrupted: ReturnType<typeof snapshot> | undefined;
    save.mockImplementationOnce(async () => {
      interrupted = snapshot();
      throw new Error('process terminated');
    });
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'process terminated',
    );
    restart(interrupted!);
    localStorage.setItem('user', JSON.stringify({ id: 'first-account' }));
    expect((await recoverBookshelfGroupChanges(env, [original]))[0]?.groupName).toBe('B');
    expect(groupJournalKeys()).toEqual([]);
  });

  it('keeps separate intents for multiple unfinished moves and replays both', async () => {
    const pending: ReturnType<typeof snapshot>[] = [];
    const interrupt = async () => {
      pending.push(snapshot());
      throw new Error('process terminated');
    };
    save.mockImplementationOnce(interrupt);
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'process terminated',
    );
    restart(pending[0]!);
    const second = { ...original, hash: 'two' };
    useLibraryStore.getState().setLibrary([original, second]);
    const current = readBookshelves(useSettingsStore.getState().settings);
    const next = current.map((s) =>
      s.id === 'default'
        ? {
            ...s,
            manualOrder: { ...s.manualOrder, 'group:C': ['b:two'] },
          }
        : s,
    );
    const moved = { ...second };
    setBookGroup(moved, md5Fingerprint('C'), 'C');
    save.mockImplementationOnce(interrupt);
    await expect(saveBookshelfGroupChanges(env, current, next, [moved])).rejects.toThrow(
      'process terminated',
    );
    restart(pending[1]!);
    expect(groupJournalKeys()).toHaveLength(2);
    const recovered = await recoverBookshelfGroupChanges(env, [original, second]);
    expect(recovered.map((book) => book.groupName)).toEqual(['B', 'C']);
    const shelf = readBookshelves(useSettingsStore.getState().settings).find(
      (s) => s.id === 'default',
    )!;
    expect(shelf.manualOrder?.['group:B']).toEqual(['b:one']);
    expect(shelf.manualOrder?.['group:C']).toEqual(['b:two']);
    expect(groupJournalKeys()).toEqual([]);
  });

  it('keeps a rollback intent when restoring the orders fails and completes it on restart', async () => {
    save.mockRejectedValueOnce(new DOMException('permission denied', 'NotAllowedError'));
    const settingsSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('settings unavailable'));
    useSettingsStore.setState({ saveSettings: settingsSave });
    await expect(saveBookshelfGroupChanges(env, base, draft, [changed])).rejects.toThrow(
      'settings unavailable',
    );
    expect(useLibraryStore.getState().library[0]?.groupName).toBe('A/B');
    expect(groupJournalKeys()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(groupJournalKeys()[0]!)!).rollback).toBe(true);
    const saved = snapshot();
    restart(saved);
    useSettingsStore.setState({ saveSettings: vi.fn().mockResolvedValue(undefined) });
    const writes = save.mock.calls.length;
    expect(await recoverBookshelfGroupChanges(env, [original])).toEqual([original]);
    expect(save).toHaveBeenCalledTimes(writes);
    expect(groupJournalKeys()).toEqual([]);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')
        ?.manualOrder?.['group:A/B'],
    ).toEqual(['b:one']);
  });
});
