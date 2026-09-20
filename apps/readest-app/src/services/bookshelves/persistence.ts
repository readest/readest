import type { BookshelfDefinition, BookshelfState } from '@/types/bookshelf';
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
  readPendingBookshelves,
  bindBookshelfOperation,
} from './journal';
import { bookshelfReplicaSchema } from './replica';

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
export const replayBookshelfOperations = async (env: EnvConfigType) => {
  const ctx = getReplicaSync();
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
  if (!ctx || !userId || !isSyncCategoryEnabled('bookshelf')) return;
  for (const original of pending) {
    const row = bindBookshelfOperation(original, userId);
    if (row.user_id === userId) ctx.manager.markDirty(row);
  }
};
export const saveBookshelfDraft = async (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
) => {
  const userId = (await getUserID()) || '';
  const { settings } = useSettingsStore.getState();
  const deviceId = settings.replicaDeviceId || 'local';
  const hlcStore = new LocalStorageHlcStore();
  const hlc =
    getReplicaSync()?.hlc ||
    HlcGenerator.restore(hlcStore.load() || { physicalMs: 0, counter: 0 }, deviceId);
  for (const row of Object.values(settings.bookshelves?.rows || {})) hlc.observe(row.updated_at_ts);
  const { state, operations } = applyBookshelfDraft(
    settings.bookshelves || { rows: {} },
    base,
    draft,
    { userId, deviceId, next: () => hlc.next() },
    settings,
  );
  if (!operations.length) return;
  hlcStore.save(hlc.serialize());
  for (const row of operations) journalBookshelfOperation(row);
  await persistState(env, state);
  await replayBookshelfOperations(env);
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
