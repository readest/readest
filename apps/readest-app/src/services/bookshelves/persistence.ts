import { isBuiltinBookshelf } from './definitions';
import type { BookshelfDefinition, BookshelfState, BookshelfReplicaRow } from '@/types/bookshelf';
import type { ReplicaRow } from '@/types/replica';
import type { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { getUserID } from '@/utils/access';
import { getReplicaSync } from '@/services/sync/replicaSync';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { HlcGenerator } from '@/libs/crdt';
import { LocalStorageHlcStore } from '@/libs/hlcStore';
import { applyBookshelfDraft, mergeBookshelfStates, readBookshelves } from './state';
import {
  journalBookshelfOperation,
  journalBookshelfBatch,
  recoverBookshelfBatches,
  readPendingBookshelves,
  bindBookshelfOperation,
  resolveLocalBookshelf,
} from './journal';
import { bookshelfReplicaSchema } from './replica';
import {
  createBookshelfOrderRows,
  createBookshelfOrderModeRow,
  readBookshelfOrderModes,
} from './orderRecords';

let writes: Promise<void> = Promise.resolve();
const persistState = (env: EnvConfigType, state: BookshelfState): Promise<void> => {
  const store = useSettingsStore.getState();
  store.setSettings({
    ...store.settings,
    bookshelves: mergeBookshelfStates(store.settings.bookshelves, state),
  });
  const save = async () => {
    const latest = useSettingsStore.getState();
    await latest.saveSettings(env, latest.settings);
  };
  writes = writes.catch(() => {}).then(save);
  return writes;
};
const publishPendingBookshelves = async (env: EnvConfigType, userId: string | null) => {
  recoverBookshelfBatches();
  const ctx = getReplicaSync();
  if (!ctx || !userId || !isSyncCategoryEnabled('bookshelf')) return;
  const rows: ReplicaRow[] = [];
  const bound: BookshelfState = { rows: {} };
  for (const original of readPendingBookshelves()) {
    const row = bindBookshelfOperation(original, userId);
    if (row.user_id !== userId) continue;
    if (original.localOnly) bound.rows[row.replica_id] = row;
    rows.push(row);
  }
  // Persist the canonical rows before queuing them. Their journals are already
  // durable, so a crash during the handoff is recovered on the next load.
  if (Object.keys(bound.rows).length) await persistState(env, bound);
  for (const row of rows) ctx.manager.markDirty(row);
};
export const replayBookshelfOperations = async (env: EnvConfigType) => {
  recoverBookshelfBatches();
  const userId = await getUserID();
  const pending = readPendingBookshelves();
  // Reapply the journal first: a crash between journaling and saving settings
  // cannot lose the user's changes, whether or not sync is currently enabled.
  if (pending.length) {
    let state: BookshelfState = { rows: {} };
    for (const row of pending)
      if (!row.user_id || row.user_id === userId)
        state = mergeBookshelfStates(state, { rows: { [row.replica_id]: row } });
    await persistState(env, state);
  }
  await publishPendingBookshelves(env, userId);
};
export const saveBookshelfDraft = async (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
) => {
  recoverBookshelfBatches();
  // AuthContext persists this identity on every platform. A native getUserID()
  // may refresh an expired token, so awaiting it would block durable local saves
  // offline and mistake a failed refresh for an anonymous edit. The sync manager
  // still checks the authenticated account before publishing any queued row.
  const user = JSON.parse(localStorage.getItem('user') || '{}') as { id?: string };
  const userId = user.id || '';
  const { settings } = useSettingsStore.getState();
  const deviceId = settings.replicaDeviceId || 'local';
  const hlcStore = new LocalStorageHlcStore();
  const hlc =
    getReplicaSync()?.hlc ||
    HlcGenerator.restore(hlcStore.load() || { physicalMs: 0, counter: 0 }, deviceId);
  for (const row of Object.values(settings.bookshelves?.rows || {})) hlc.observe(row.updated_at_ts);
  const applied = applyBookshelfDraft(
    settings.bookshelves || { rows: {} },
    base,
    draft,
    { userId, deviceId, next: () => hlc.next() },
    settings,
  );
  let state = applied.state;
  const operations = applied.operations;
  const orderOperations: ReplicaRow[] = [];
  const modes = readBookshelfOrderModes(Object.values(settings.bookshelves?.rows ?? {}));
  for (const shelf of draft) {
    const original = base.find((original) => original.id === shelf.id);
    const previous = original?.manualOrder;
    const active = shelf.sort.by === 'custom' && shelf.useGlobalSort === false;
    const wasActive = original?.sort.by === 'custom' && original.useGlobalSort === false;
    const definitionStamp = state.rows[shelf.id]?.fields_jsonb['definition']?.t ?? null;
    if (
      active !== !!wasActive ||
      (active && modes.get(shelf.id)?.definitionStamp !== definitionStamp)
    ) {
      orderOperations.push(
        createBookshelfOrderModeRow(shelf.id, active, definitionStamp, {
          userId,
          deviceId,
          next: () => hlc.next(),
        }),
      );
    }
    for (const scope of new Set([
      ...Object.keys(previous ?? {}),
      ...Object.keys(shelf.manualOrder ?? {}),
    ])) {
      const ids = shelf.manualOrder?.[scope] ?? [];
      if (JSON.stringify(ids) === JSON.stringify(previous?.[scope] ?? [])) continue;
      const rows = createBookshelfOrderRows(
        shelf.id,
        scope,
        ids,
        {
          userId,
          deviceId,
          next: () => hlc.next(),
        },
        shelf.manualOrderUpdatedAt?.[scope] ?? original?.manualOrderUpdatedAt?.[scope],
      );
      orderOperations.push(...rows);
    }
  }
  if (orderOperations.length) {
    operations.push(...orderOperations);
    state = mergeBookshelfStates(state, {
      rows: Object.fromEntries(orderOperations.map((row) => [row.replica_id, row])),
    });
  }
  if (!operations.length) return;
  hlcStore.save(hlc.serialize());
  const prepared: BookshelfReplicaRow[] = [];
  for (const row of operations) {
    const previous = settings.bookshelves?.rows[row.replica_id];
    // A stale editor must not recreate a local shelf discarded in another window.
    if (
      (previous?.localOnly && !resolveLocalBookshelf(previous)) ||
      (!previous &&
        !isBuiltinBookshelf(row.replica_id) &&
        base.some((s) => s.id === row.replica_id))
    ) {
      delete state.rows[row.replica_id];
      continue;
    }
    const localOnly =
      !userId &&
      !previous &&
      !isBuiltinBookshelf(row.replica_id) &&
      !base.some((shelf) => shelf.id === row.replica_id);
    prepared.push({
      ...row,
      ...(localOnly ? { localOnly: true as const } : {}),
    });
  }
  const journaled = orderOperations.length
    ? journalBookshelfBatch(prepared)
    : prepared.map(journalBookshelfOperation);
  prepared.forEach((row, index) => {
    const pending = journaled[index];
    if (pending) state.rows[row.replica_id] = pending;
    else delete state.rows[row.replica_id];
  });
  // The draft state already carries the journaled rows, so publish without
  // replaying — a replay would persist the very same state a second time, and
  // the editor autosaves on every keystroke.
  await persistState(env, state);
  await publishPendingBookshelves(env, userId);
};
export const updateBookshelf = async (
  env: EnvConfigType,
  id: string,
  update: (shelf: BookshelfDefinition) => BookshelfDefinition,
) => {
  const base = readBookshelves(useSettingsStore.getState().settings);
  await saveBookshelfDraft(
    env,
    base,
    base.map((s) => (s.id === id ? update(s) : s)),
  );
};
export const applyRemoteBookshelfRows = async (env: EnvConfigType, rows: ReplicaRow[]) => {
  let state: BookshelfState = { rows: {} };
  for (const row of rows) {
    if (!bookshelfReplicaSchema.safeParse(row).success) continue;
    state = mergeBookshelfStates(state, { rows: { [row.replica_id]: row } });
  }
  if (Object.keys(state.rows).length) await persistState(env, state);
};
