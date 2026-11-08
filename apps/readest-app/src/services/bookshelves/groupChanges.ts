import type { Book } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import type { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { pickFresherGroup } from '@/utils/book';
import { saveBookshelfDraft } from './persistence';
import { readBookshelves } from './state';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep the previous paths and orders usable if the library write fails. */
export const saveBookshelfGroupChanges = async (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
  changed: Book[],
) => {
  // Settings can take time to save. Merge only membership into the live books,
  // preserving imports, deletions and reading progress received while waiting.
  const changes = new Map(changed.map((book) => [book.hash, book]));
  const updatesFor = (library: Book[]) =>
    library.map((book) =>
      !book.deletedAt && changes.has(book.hash)
        ? { ...book, ...pickFresherGroup(book, changes.get(book.hash)!, true) }
        : book,
    );
  let committed = false;
  try {
    await saveBookshelfDraft(env, base, draft);
    const appService = await env.getAppService();
    let snapshot: Book[];
    let updates: Book[];
    do {
      snapshot = useLibraryStore.getState().library;
      updates = updatesFor(snapshot);
      // Publish membership to Zustand (and automatic sync) only after saving it.
      // Retry the latest full snapshot so concurrent imports and tombstones also
      // survive an earlier in-flight write of the library file.
      await appService.saveLibraryBooks(updates);
      committed = true;
    } while (snapshot !== useLibraryStore.getState().library);
  } catch (error) {
    // A successful first write commits the move. A failed later progress retry
    // must not roll its orders back while the new membership is already on disk.
    if (committed) throw error;
    const current = readBookshelves(useSettingsStore.getState().settings);
    const restored = current.map((shelf) => {
      const before = base.find((s) => s.id === shelf.id);
      const attempted = draft.find((s) => s.id === shelf.id);
      if (!before || !attempted) return shelf;
      const next = {
        ...shelf,
        manualOrder: { ...shelf.manualOrder },
        manualOrderUpdatedAt: { ...shelf.manualOrderUpdatedAt },
      };
      // Revert only this operation's fields, leaving independent sync edits intact.
      for (const key of ['sort', 'useGlobalSort', 'customSortFallback'] as const) {
        if (!equal(before[key], attempted[key]) && equal(shelf[key], attempted[key]))
          Object.assign(next, { [key]: before[key] });
      }
      for (const scope of new Set([
        ...Object.keys(before.manualOrder ?? {}),
        ...Object.keys(attempted.manualOrder ?? {}),
      ])) {
        const oldOrder = before.manualOrder?.[scope] ?? [];
        const newOrder = attempted.manualOrder?.[scope] ?? [];
        if (!equal(oldOrder, newOrder) && equal(shelf.manualOrder?.[scope] ?? [], newOrder)) {
          next.manualOrder[scope] = oldOrder;
          const orderedAt = before.manualOrderUpdatedAt?.[scope];
          if (orderedAt === undefined) delete next.manualOrderUpdatedAt[scope];
          else next.manualOrderUpdatedAt[scope] = orderedAt;
        }
      }
      return next;
    });
    await saveBookshelfDraft(env, current, restored);
    throw error;
  } finally {
    if (committed)
      await useLibraryStore.getState().updateBooks(
        env,
        updatesFor(useLibraryStore.getState().library).filter((book) => changes.has(book.hash)),
        { skipSave: true },
      );
  }
};
