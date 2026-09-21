import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ReplicaRow } from '@/types/replica';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import {
  applyRemoteBookshelfRows,
  replayBookshelfOperations,
  saveBookshelfDraft,
} from '@/services/bookshelves/persistence';
import { readPendingBookshelves } from '@/services/bookshelves/journal';
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
