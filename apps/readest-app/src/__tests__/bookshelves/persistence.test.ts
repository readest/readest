import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ReplicaRow } from '@/types/replica';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { mergeBookshelfStates, readBookshelves } from '@/services/bookshelves/state';
import {
  applyRemoteBookshelfRows,
  replayBookshelfOperations,
  saveBookshelfDraft,
} from '@/services/bookshelves/persistence';
import {
  acknowledgeBookshelfOperation,
  readPendingBookshelves,
} from '@/services/bookshelves/journal';
import { getUserID } from '@/utils/access';

const mocks = vi.hoisted(() => ({
  userId: 'account',
  connected: false,
  markDirty: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({ getUserID: vi.fn(async () => mocks.userId) }));
const hlc = new HlcGenerator('device');
vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: () => (mocks.connected ? { hlc, manager: { markDirty: mocks.markDirty } } : null),
}));
const env = {} as EnvConfigType;
beforeEach(() => {
  localStorage.clear();
  mocks.userId = 'account';
  localStorage.setItem('user', JSON.stringify({ id: mocks.userId }));
  vi.mocked(getUserID)
    .mockReset()
    .mockImplementation(async () => mocks.userId);
  mocks.connected = false;
  mocks.markDirty.mockClear();
  mocks.saveSettings.mockClear();
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, replicaDeviceId: 'device' } as SystemSettings,
    saveSettings: mocks.saveSettings,
  });
});
describe('bookshelf persistence and sync integration', () => {
  it.each([
    false,
    true,
  ])('preserves stale-window edits after anonymous publication (acknowledged: %s)', async (acknowledged) => {
    localStorage.removeItem('user');
    mocks.userId = '';
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Created in another window');
    await saveBookshelfDraft(env, base, [...base, custom]);
    const staleSettings = useSettingsStore.getState().settings;
    expect(staleSettings.bookshelves?.rows[custom.id]?.localOnly).toBe(true);

    mocks.userId = 'account';
    localStorage.setItem('user', JSON.stringify({ id: mocks.userId }));
    mocks.connected = true;
    await replayBookshelfOperations(env);
    const published = mocks.markDirty.mock.calls[0]![0] as ReplicaRow;
    const persistedSettings = useSettingsStore.getState().settings;
    expect(persistedSettings.bookshelves?.rows[custom.id]?.user_id).toBe('account');
    expect(persistedSettings.bookshelves?.rows[custom.id]?.localOnly).toBeUndefined();
    if (acknowledged) acknowledgeBookshelfOperation(published);

    // The other window has not received the settings broadcast yet.
    useSettingsStore.setState({ settings: staleSettings });
    await saveBookshelfDraft(
      env,
      [...base, custom],
      [...base, { ...custom, name: 'Edited after publication' }],
    );
    const pending = readPendingBookshelves().find((row) => row.replica_id === custom.id);
    expect(pending?.fields_jsonb['definition']?.v).toMatchObject({
      name: 'Edited after publication',
    });
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === custom.id)?.name,
    ).toBe('Edited after publication');
  });

  it('discards anonymous shelves created and deleted locally, including stale cached state', async () => {
    localStorage.removeItem('user');
    mocks.userId = '';
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Never published');
    await saveBookshelfDraft(env, base, [...base, custom]);
    const cached = useSettingsStore.getState().settings.bookshelves;
    await saveBookshelfDraft(env, [...base, custom], base);
    expect(readPendingBookshelves()).toEqual([]);
    expect(useSettingsStore.getState().settings.bookshelves?.rows[custom.id]).toBeUndefined();
    expect(mergeBookshelfStates(cached).rows[custom.id]).toBeUndefined();
    expect(readBookshelves({ bookshelves: cached }).some((s) => s.id === custom.id)).toBe(false);
    mocks.userId = 'account';
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('does not resurrect a discarded shelf from a stale editor', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Discarded');
    await saveBookshelfDraft(env, base, [...base, custom]);
    await saveBookshelfDraft(env, [...base, custom], base);
    await saveBookshelfDraft(env, [...base, custom], [...base, { ...custom, name: 'Stale edit' }]);
    expect(readPendingBookshelves()).toEqual([]);
    expect(useSettingsStore.getState().settings.bookshelves?.rows[custom.id]).toBeUndefined();
  });

  it('keeps thousands of anonymous create/delete cycles bounded', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    for (let i = 0; i < 1000; i++) {
      const custom = createBookshelf(`Temporary ${i}`);
      await saveBookshelfDraft(env, base, [...base, custom]);
      await saveBookshelfDraft(env, [...base, custom], base);
    }
    expect(readPendingBookshelves()).toEqual([]);
    expect(Object.keys(useSettingsStore.getState().settings.bookshelves?.rows || {})).toEqual([]);
    expect(localStorage.length).toBe(1); // Only the logical clock remains.
  });

  it('keeps legacy anonymous deletions when creation provenance is unknown', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Legacy');
    const t = hlc.next();
    await applyRemoteBookshelfRows(env, [
      {
        user_id: '',
        kind: 'bookshelf',
        replica_id: custom.id,
        fields_jsonb: { definition: { v: custom, t, s: 'device' } },
        updated_at_ts: t,
        deleted_at_ts: null,
        manifest_jsonb: null,
        reincarnation: null,
        schema_version: 1,
      },
    ]);
    await saveBookshelfDraft(env, [...base, custom], base);
    expect(readPendingBookshelves()[0]?.deleted_at_ts).toBeTruthy();
  });

  it('retains deletions once an anonymous shelf has been handed to sync', async () => {
    localStorage.removeItem('user');
    mocks.userId = '';
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Published');
    await saveBookshelfDraft(env, base, [...base, custom]);
    mocks.userId = 'account';
    localStorage.setItem('user', JSON.stringify({ id: mocks.userId }));
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).toHaveBeenCalled();
    const published = mocks.markDirty.mock.calls[0]![0];
    expect(published).not.toHaveProperty('localOnly');
    expect(
      readBookshelves(useSettingsStore.getState().settings).some((s) => s.id === custom.id),
    ).toBe(true);
    await saveBookshelfDraft(env, [...base, custom], base);
    expect(
      readPendingBookshelves().find((r) => r.replica_id === custom.id)?.deleted_at_ts,
    ).toBeTruthy();
    expect(
      useSettingsStore.getState().settings.bookshelves?.rows[custom.id]?.deleted_at_ts,
    ).toBeTruthy();
  });

  it('saves offline edits under the cached account without waiting for token refresh', async () => {
    let finishRefresh: (() => void) | undefined;
    vi.mocked(getUserID).mockImplementationOnce(
      () => new Promise((resolve) => (finishRefresh = () => resolve(null))),
    );
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Offline with expired token');
    const saving = saveBookshelfDraft(env, base, [custom, ...base]);
    try {
      expect(readPendingBookshelves()).toContainEqual(
        expect.objectContaining({ user_id: 'account', replica_id: custom.id }),
      );
      await saving;
      expect(mocks.saveSettings).toHaveBeenCalledOnce();
      expect(getUserID).not.toHaveBeenCalled();
      mocks.userId = 'other-account';
      vi.mocked(getUserID).mockReset().mockResolvedValue(mocks.userId);
      mocks.connected = true;
      await replayBookshelfOperations(env);
      expect(mocks.markDirty).not.toHaveBeenCalled();
    } finally {
      finishRefresh?.();
      await saving;
    }
  });
  it('recovers offline edits after restart with original timestamps', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Offline');
    await saveBookshelfDraft(env, base, [custom, ...base]);
    const original = readPendingBookshelves()[0]!;
    expect(original.user_id).toBe('account');
    useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings });
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === custom.id)?.name,
    ).toBe('Offline');
    expect(mocks.markDirty).toHaveBeenCalledWith(original);
    expect(readPendingBookshelves()[0]!.updated_at_ts).toBe(original.updated_at_ts);
  });
  it('persists a draft once per autosave', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    mocks.connected = true;
    await saveBookshelfDraft(env, base, [createBookshelf('Once'), ...base]);
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
    expect(mocks.markDirty).toHaveBeenCalledOnce();
  });
  it('merges remote definitions without publishing them or losing a newer pending edit', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    const t = hlc.next();
    const remote: ReplicaRow = {
      user_id: 'account',
      kind: 'bookshelf',
      replica_id: 'default',
      fields_jsonb: {
        definition: {
          v: { ...base.find((s) => s.id === 'default')!, name: 'Old remote' },
          t,
          s: 'remote',
        },
      },
      updated_at_ts: t,
      deleted_at_ts: null,
      manifest_jsonb: null,
      reincarnation: null,
      schema_version: 1,
    };
    await applyRemoteBookshelfRows(env, [remote]);
    expect(readPendingBookshelves()).toEqual([]);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    const latest = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      env,
      latest,
      latest.map((s) => (s.id === 'default' ? { ...s, name: 'New local' } : s)),
    );
    const pending = readPendingBookshelves();
    await applyRemoteBookshelfRows(env, [remote]);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')?.name,
    ).toBe('New local');
    expect(readPendingBookshelves()).toEqual(pending);
  });
  it('never queues another account’s pending operations', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(env, base, [createBookshelf('Account A'), ...base]);
    mocks.userId = 'other-account';
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    expect(readPendingBookshelves()[0]!.user_id).toBe('account');
  });
  it('follows App settings sync independently of file-provider selection', async () => {
    const settings = {
      ...useSettingsStore.getState().settings,
      syncCategories: { settings: false, dictionary: false },
      readestCloud: { enabled: false },
    };
    useSettingsStore.setState({ settings });
    mocks.connected = true;
    const base = readBookshelves(settings);
    await saveBookshelfDraft(env, base, [createBookshelf('Local only'), ...base]);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, syncCategories: { settings: true } },
    });
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).toHaveBeenCalled();
  });
});
