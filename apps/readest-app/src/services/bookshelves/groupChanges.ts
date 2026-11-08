import type { Book } from '@/types/book';
import type { BookshelfDefinition, BookshelfState } from '@/types/bookshelf';
import type { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { pickFresherGroup } from '@/utils/book';
import { saveBookshelfDraft } from './persistence';
import { readBookshelves } from './state';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PREFIX = 'readest.bookshelf.group-change.v1:';
const ORDER_FIELDS = ['sort', 'useGlobalSort', 'customSortFallback'] as const;
type OrderSnapshot = { id: string; sortVersion?: string } & Partial<
  Pick<BookshelfDefinition, (typeof ORDER_FIELDS)[number] | 'manualOrder' | 'manualOrderUpdatedAt'>
>;
type Membership = Pick<Book, 'hash' | 'groupId' | 'groupName' | 'groupUpdatedAt'>;
interface GroupChange {
  account: string;
  createdAt: number;
  before: OrderSnapshot[];
  after: OrderSnapshot[];
  books: Membership[];
  rollback: boolean;
}
let writes: Promise<unknown> = Promise.resolve();
const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = writes.catch(() => {}).then(operation);
  writes = next;
  return next;
};
const account = () =>
  (JSON.parse(localStorage.getItem('user') || '{}') as { id?: string }).id || '';
const sortVersion = (state: BookshelfState | undefined, id: string) => {
  const mode = Object.values(state?.rows ?? {}).find(
    (row) =>
      !row.deleted_at_ts &&
      (row.fields_jsonb['itemOrderMode']?.v as { shelfId?: string } | undefined)?.shelfId === id,
  );
  return JSON.stringify([
    state?.rows[id]?.fields_jsonb['definition']?.t ?? null,
    mode?.fields_jsonb['itemOrderMode']?.t ?? null,
  ]);
};

const orderChanges = (base: BookshelfDefinition[], draft: BookshelfDefinition[]) => {
  const before: OrderSnapshot[] = [];
  const after: OrderSnapshot[] = [];
  for (const shelf of draft) {
    const original = base.find((candidate) => candidate.id === shelf.id);
    if (!original) continue;
    const old: OrderSnapshot = { id: shelf.id };
    const next: OrderSnapshot = { id: shelf.id };
    for (const key of ORDER_FIELDS) {
      if (!equal(original[key], shelf[key])) {
        Object.assign(old, { [key]: original[key] });
        Object.assign(next, { [key]: shelf[key] });
      }
    }
    for (const scope of new Set([
      ...Object.keys(original.manualOrder ?? {}),
      ...Object.keys(shelf.manualOrder ?? {}),
    ])) {
      if (
        equal(original.manualOrder?.[scope] ?? [], shelf.manualOrder?.[scope] ?? []) &&
        original.manualOrderUpdatedAt?.[scope] === shelf.manualOrderUpdatedAt?.[scope]
      )
        continue;
      (old.manualOrder ??= {})[scope] = original.manualOrder?.[scope] ?? [];
      (next.manualOrder ??= {})[scope] = shelf.manualOrder?.[scope] ?? [];
      const oldTime = original.manualOrderUpdatedAt?.[scope];
      const nextTime = shelf.manualOrderUpdatedAt?.[scope];
      if (oldTime !== undefined) (old.manualOrderUpdatedAt ??= {})[scope] = oldTime;
      if (nextTime !== undefined) (next.manualOrderUpdatedAt ??= {})[scope] = nextTime;
    }
    if (Object.keys(old).length > 1 || Object.keys(next).length > 1) {
      old.sortVersion = sortVersion(useSettingsStore.getState().settings.bookshelves, shelf.id);
      before.push(old);
      after.push(next);
    }
  }
  return { before, after };
};

/** Apply only this move's deltas; newer independent shelf edits remain intact. */
const applyOrderChanges = (
  current: BookshelfDefinition[],
  from: OrderSnapshot[],
  to: OrderSnapshot[],
) =>
  current.map((shelf) => {
    const old = from.find((candidate) => candidate.id === shelf.id);
    const next = to.find((candidate) => candidate.id === shelf.id);
    if (!old || !next) return shelf;
    const result = {
      ...shelf,
      manualOrder: { ...shelf.manualOrder },
      manualOrderUpdatedAt: { ...shelf.manualOrderUpdatedAt },
    };
    for (const key of ORDER_FIELDS) {
      if (
        (key in old || key in next) &&
        !equal(shelf[key], next[key]) &&
        equal(shelf[key], old[key]) &&
        old.sortVersion !== undefined &&
        sortVersion(useSettingsStore.getState().settings.bookshelves, shelf.id) === old.sortVersion
      )
        Object.assign(result, { [key]: next[key] });
    }
    for (const scope of Object.keys(next.manualOrder ?? {})) {
      const ids = shelf.manualOrder?.[scope] ?? [];
      const currentTime = shelf.manualOrderUpdatedAt?.[scope];
      if (
        !(
          equal(ids, old.manualOrder?.[scope] ?? []) &&
          currentTime === old.manualOrderUpdatedAt?.[scope]
        ) &&
        !(
          equal(ids, next.manualOrder?.[scope] ?? []) &&
          currentTime === next.manualOrderUpdatedAt?.[scope]
        )
      )
        continue;
      result.manualOrder[scope] = next.manualOrder![scope]!;
      const time = next.manualOrderUpdatedAt?.[scope];
      if (time === undefined) delete result.manualOrderUpdatedAt[scope];
      else result.manualOrderUpdatedAt[scope] = time;
    }
    return result;
  });

const saveGroupOrders = (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
  key: string,
  change: GroupChange,
) => {
  const previous = useSettingsStore.getState().settings.bookshelves;
  const target = change.rollback ? change.before : change.after;
  return saveBookshelfDraft(env, base, draft, (state) => {
    for (const shelf of target) {
      const version = sortVersion(state, shelf.id);
      // A no-op must not claim a newer independent metadata choice as ours.
      if (version !== sortVersion(previous, shelf.id)) shelf.sortVersion = version;
    }
    localStorage.setItem(key, JSON.stringify(change));
  });
};

const updateMembership = (library: Book[], changes: Map<string, Membership>) =>
  library.map((book) => {
    const changed = changes.get(book.hash);
    return !book.deletedAt && changed
      ? {
          ...book,
          ...pickFresherGroup(
            book,
            {
              ...book,
              groupId: changed.groupId,
              groupName: changed.groupName,
              groupUpdatedAt: changed.groupUpdatedAt,
            },
            true,
          ),
        }
      : book;
  });

const saveMembership = async (
  env: EnvConfigType,
  changes: Map<string, Membership>,
  committed: () => void,
  source?: Book[],
) => {
  const initial = useLibraryStore.getState().library;
  const appService = await env.getAppService();
  let library = source ?? useLibraryStore.getState().library;
  if (useLibraryStore.getState().libraryLoaded && initial !== useLibraryStore.getState().library)
    library = useLibraryStore.getState().library;
  while (true) {
    const snapshot = useLibraryStore.getState().library;
    const updates = updateMembership(library, changes);
    await appService.saveLibraryBooks(updates, { throwOnFailure: true });
    committed();
    if (snapshot === useLibraryStore.getState().library) return updates;
    library = useLibraryStore.getState().library;
  }
};

/** Complete interrupted moves before publishing a loaded library, including offline. */
export const recoverBookshelfGroupChanges = (env: EnvConfigType, books: Book[]) => {
  const openingLibrary = useLibraryStore.getState().library;
  return serialize(async () => {
    const latest = useLibraryStore.getState().library;
    let library = latest !== openingLibrary ? latest : books;
    const records: { key: string; change: GroupChange }[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const change = JSON.parse(localStorage.getItem(key) || 'null') as GroupChange | null;
        if (
          change &&
          typeof change.account === 'string' &&
          Array.isArray(change.before) &&
          Array.isArray(change.after) &&
          Array.isArray(change.books) &&
          (!change.account || change.account === account())
        )
          records.push({ key, change });
      } catch {
        /* Keep unreadable recovery records for a later retry. */
      }
    }
    for (const { key, change } of records.sort((a, b) => a.change.createdAt - b.change.createdAt)) {
      const current = readBookshelves(useSettingsStore.getState().settings);
      await saveGroupOrders(
        env,
        current,
        applyOrderChanges(
          current,
          change.rollback ? change.after : change.before,
          change.rollback ? change.before : change.after,
        ),
        key,
        change,
      );
      if (!change.rollback)
        library = await saveMembership(
          env,
          new Map(change.books.map((book) => [book.hash, book])),
          () => {},
          library,
        );
      localStorage.removeItem(key);
    }
    return library;
  });
};

/** Keep the previous paths and orders usable if the library write fails. */
export const saveBookshelfGroupChanges = (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
  changed: Book[],
) =>
  serialize(async () => {
    // Settings can take time to save. Merge only membership into the live books,
    // preserving imports, deletions and reading progress received while waiting.
    const changes = new Map(changed.map((book) => [book.hash, book]));
    const createdAt = Date.now();
    // Fix a new scope's baseline before journaling so replay cannot move it
    // forward, or mistake a later same-order rearrangement for this move.
    const prepared = draft.map((shelf) => {
      const original = base.find((candidate) => candidate.id === shelf.id);
      const times = { ...shelf.manualOrderUpdatedAt };
      for (const scope of new Set([
        ...Object.keys(original?.manualOrder ?? {}),
        ...Object.keys(shelf.manualOrder ?? {}),
      ]))
        if (
          !equal(shelf.manualOrder?.[scope] ?? [], original?.manualOrder?.[scope] ?? []) &&
          times[scope] === undefined
        )
          times[scope] = original?.manualOrderUpdatedAt?.[scope] ?? createdAt;
      return { ...shelf, manualOrderUpdatedAt: times };
    });
    const key = `${PREFIX}${crypto.randomUUID()}`;
    const change: GroupChange = {
      account: account(),
      createdAt,
      ...orderChanges(base, prepared),
      books: changed.map(({ hash, groupId, groupName, groupUpdatedAt }) => ({
        hash,
        groupId,
        groupName,
        groupUpdatedAt,
      })),
      rollback: false,
    };
    localStorage.setItem(key, JSON.stringify(change));
    let committed = false;
    try {
      await saveGroupOrders(env, base, prepared, key, change);
      await saveMembership(env, changes, () => {
        committed = true;
      });
    } catch (error) {
      // A successful first write commits the move. A failed later progress retry
      // must not roll its orders back while the new membership is already on disk.
      if (committed) throw error;
      change.rollback = true;
      localStorage.setItem(key, JSON.stringify(change));
      const current = readBookshelves(useSettingsStore.getState().settings);
      await saveGroupOrders(
        env,
        current,
        applyOrderChanges(current, change.after, change.before),
        key,
        change,
      );
      localStorage.removeItem(key);
      throw error;
    } finally {
      if (committed)
        await useLibraryStore.getState().updateBooks(
          env,
          updateMembership(useLibraryStore.getState().library, changes).filter((book) =>
            changes.has(book.hash),
          ),
          { skipSave: true },
        );
      if (committed) localStorage.removeItem(key);
    }
  });
