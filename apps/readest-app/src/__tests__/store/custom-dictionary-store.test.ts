import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/sync/replicaPublish', () => ({
  publishDictionaryDelete: vi.fn(),
  publishDictionaryUpsert: vi.fn(),
}));

import {
  useCustomDictionaryStore,
  enableReplicaAutoPersist,
  findDictionaryByContentId,
} from '@/store/customDictionaryStore';
import { BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';
import { publishDictionaryUpsert } from '@/services/sync/replicaPublish';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { ImportedDictionary } from '@/services/dictionaries/types';

const ZERO = (s: string) => s.startsWith('web:builtin:');
const mockPublishDictionaryUpsert = vi.mocked(publishDictionaryUpsert);

describe('customDictionaryStore — web search CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state to defaults so tests don't bleed.
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: [
          BUILTIN_WEB_SEARCH_IDS.google,
          BUILTIN_WEB_SEARCH_IDS.urban,
          BUILTIN_WEB_SEARCH_IDS.merriamWebster,
        ],
        providerEnabled: {
          [BUILTIN_WEB_SEARCH_IDS.google]: false,
          [BUILTIN_WEB_SEARCH_IDS.urban]: false,
          [BUILTIN_WEB_SEARCH_IDS.merriamWebster]: false,
        },
        webSearches: [],
      },
    });
  });

  it('seeds the three built-in web ids in default order, all disabled', () => {
    const { settings } = useCustomDictionaryStore.getState();
    const builtinWeb = settings.providerOrder.filter(ZERO);
    expect(builtinWeb).toEqual([
      BUILTIN_WEB_SEARCH_IDS.google,
      BUILTIN_WEB_SEARCH_IDS.urban,
      BUILTIN_WEB_SEARCH_IDS.merriamWebster,
    ]);
    for (const id of builtinWeb) {
      expect(settings.providerEnabled[id]).toBe(false);
    }
  });

  it('addWebSearch appends to order, enables, returns the entry', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('My Site', 'https://example.com/?q=%WORD%');
    expect(entry.id.startsWith('web:')).toBe(true);
    expect(entry.id.startsWith('web:builtin:')).toBe(false);
    expect(entry.name).toBe('My Site');
    expect(entry.urlTemplate).toBe('https://example.com/?q=%WORD%');

    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(true);
    expect(after.providerEnabled[entry.id]).toBe(true);
    expect((after.webSearches ?? []).map((w) => w.id)).toEqual([entry.id]);
  });

  it('addWebSearch trims whitespace from name and URL', () => {
    const { addWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('  Spaced Name  ', '   https://x.com/?q=%WORD%   ');
    expect(entry.name).toBe('Spaced Name');
    expect(entry.urlTemplate).toBe('https://x.com/?q=%WORD%');
  });

  it('updateWebSearch updates name + URL of a custom entry', () => {
    const { addWebSearch, updateWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Old', 'https://old.com/?q=%WORD%');
    updateWebSearch(entry.id, { name: 'New', urlTemplate: 'https://new.com/?q=%WORD%' });
    const list = useCustomDictionaryStore.getState().settings.webSearches ?? [];
    const updated = list.find((w) => w.id === entry.id);
    expect(updated?.name).toBe('New');
    expect(updated?.urlTemplate).toBe('https://new.com/?q=%WORD%');
  });

  it('updateWebSearch is a no-op for built-in ids', () => {
    const { updateWebSearch, settings } = useCustomDictionaryStore.getState();
    updateWebSearch(BUILTIN_WEB_SEARCH_IDS.google, { name: 'Hijacked' });
    // No `webSearches` entry was added or modified.
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.webSearches).toEqual(settings.webSearches ?? []);
  });

  it('removeWebSearch soft-deletes a custom entry and removes it from order/enabled', () => {
    const { addWebSearch, removeWebSearch } = useCustomDictionaryStore.getState();
    const entry = addWebSearch('Tmp', 'https://tmp.com/?q=%WORD%');
    expect(removeWebSearch(entry.id)).toBe(true);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(entry.id)).toBe(false);
    expect(entry.id in after.providerEnabled).toBe(false);
    const found = (after.webSearches ?? []).find((w) => w.id === entry.id);
    expect(found?.deletedAt).toBeGreaterThan(0);
  });

  it('removeWebSearch refuses built-in ids', () => {
    const { removeWebSearch } = useCustomDictionaryStore.getState();
    expect(removeWebSearch(BUILTIN_WEB_SEARCH_IDS.google)).toBe(false);
    const after = useCustomDictionaryStore.getState().settings;
    expect(after.providerOrder.includes(BUILTIN_WEB_SEARCH_IDS.google)).toBe(true);
  });

  it('updateDictionary patches the display name (trimmed) and ignores empty / unchanged input', () => {
    const { addDictionary, updateDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'mdict:abc',
      kind: 'mdict',
      name: 'Title (No HTML code allowed)',
      bundleDir: 'abc',
      files: { mdx: 'abc.mdx' },
      addedAt: 1,
    });

    updateDictionary('mdict:abc', { name: '  Webster MW11  ' });
    let dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Same name (no-op).
    updateDictionary('mdict:abc', { name: 'Webster MW11' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Empty / whitespace patch is rejected — keep existing name.
    updateDictionary('mdict:abc', { name: '   ' });
    dict = useCustomDictionaryStore.getState().dictionaries.find((d) => d.id === 'mdict:abc');
    expect(dict?.name).toBe('Webster MW11');

    // Unknown id: silent no-op.
    expect(() => updateDictionary('mdict:nope', { name: 'X' })).not.toThrow();
  });

  describe('replica auto-persist', () => {
    const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
      id: 'remote-bundle-1',
      contentId: 'content-hash-1',
      kind: 'mdict',
      name: 'Remote Webster',
      bundleDir: 'remote-bundle-1',
      files: { mdx: 'webster.mdx' },
      addedAt: 1,
      unavailable: true,
      ...overrides,
    });

    const setupSpyEnv = () => {
      // saveCustomDictionaries calls setSettings + saveSettings on the
      // settings store. Spy both to assert the chain fires.
      const setSettings = vi.spyOn(useSettingsStore.getState(), 'setSettings');
      const saveSettings = vi
        .spyOn(useSettingsStore.getState(), 'saveSettings')
        .mockResolvedValue(undefined);
      const fakeEnv = { name: 'test-env' } as unknown as EnvConfigType;
      enableReplicaAutoPersist(fakeEnv);
      return { setSettings, saveSettings, fakeEnv };
    };

    it('applyRemoteDictionary persists state via saveCustomDictionaries when env is registered', async () => {
      const { setSettings, saveSettings, fakeEnv } = setupSpyEnv();
      useCustomDictionaryStore.getState().applyRemoteDictionary(baseDict());

      // setSettings runs synchronously inside saveCustomDictionaries; the
      // microtask queue flush makes the fire-and-forget save observable.
      await Promise.resolve();
      await Promise.resolve();
      expect(setSettings).toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalledWith(fakeEnv, expect.any(Object));
      const persisted = setSettings.mock.calls.at(-1)![0];
      expect(persisted.customDictionaries?.some((d) => d.id === 'remote-bundle-1')).toBe(true);
    });

    it('softDeleteByContentId persists state via saveCustomDictionaries when env is registered', async () => {
      const { saveSettings } = setupSpyEnv();
      // Seed an alive dict to be tombstoned.
      useCustomDictionaryStore.getState().applyRemoteDictionary(baseDict());
      saveSettings.mockClear();

      useCustomDictionaryStore.getState().softDeleteByContentId('content-hash-1');
      await Promise.resolve();
      await Promise.resolve();
      expect(saveSettings).toHaveBeenCalledOnce();
    });

    it('does not persist when env has not been registered', async () => {
      // Wipe the registry by re-enabling with null-equivalent. We expose
      // enableReplicaAutoPersist with a nullable arg for test isolation.
      enableReplicaAutoPersist(null);
      const setSettings = vi.spyOn(useSettingsStore.getState(), 'setSettings');
      const saveSettings = vi
        .spyOn(useSettingsStore.getState(), 'saveSettings')
        .mockResolvedValue(undefined);

      useCustomDictionaryStore.getState().applyRemoteDictionary(baseDict());
      await Promise.resolve();
      await Promise.resolve();
      expect(setSettings).not.toHaveBeenCalled();
      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  describe('findDictionaryByContentId', () => {
    it('returns the in-memory dict when present', () => {
      useCustomDictionaryStore.getState().applyRemoteDictionary({
        id: 'in-mem-1',
        contentId: 'hash-1',
        kind: 'mdict',
        name: 'In Memory',
        bundleDir: 'in-mem-1',
        files: { mdx: 'm.mdx' },
        addedAt: 1,
      });
      const found = findDictionaryByContentId('hash-1');
      expect(found?.id).toBe('in-mem-1');
    });

    it('falls back to settings.customDictionaries when in-memory store has no match', () => {
      // Simulate fresh-boot state: in-memory store empty, but persisted
      // settings (loaded from disk) carries the dict.
      useSettingsStore.setState({
        settings: {
          customDictionaries: [
            {
              id: 'persisted-1',
              contentId: 'hash-2',
              kind: 'mdict',
              name: 'Persisted',
              bundleDir: 'persisted-1',
              files: { mdx: 'p.mdx' },
              addedAt: 1,
            },
          ],
        } as never,
      });
      const found = findDictionaryByContentId('hash-2');
      expect(found?.id).toBe('persisted-1');
    });

    it('returns undefined when neither store has it', () => {
      useSettingsStore.setState({ settings: {} as never });
      expect(findDictionaryByContentId('hash-nope')).toBeUndefined();
    });

    it('skips tombstoned persisted entries', () => {
      useSettingsStore.setState({
        settings: {
          customDictionaries: [
            {
              id: 'tombstoned-1',
              contentId: 'hash-3',
              kind: 'mdict',
              name: 'Tombstoned',
              bundleDir: 'tombstoned-1',
              files: { mdx: 'p.mdx' },
              addedAt: 1,
              deletedAt: 100,
            },
          ],
        } as never,
      });
      expect(findDictionaryByContentId('hash-3')).toBeUndefined();
    });
  });

  it('updateDictionary preserves reincarnation when publishing a renamed dictionary', () => {
    const { addDictionary, updateDictionary } = useCustomDictionaryStore.getState();
    addDictionary({
      id: 'mdict:abc',
      contentId: 'content-abc',
      kind: 'mdict',
      name: 'Old title',
      bundleDir: 'abc',
      files: { mdx: 'abc.mdx' },
      addedAt: 1,
      reincarnation: 'epoch-1',
    });

    mockPublishDictionaryUpsert.mockClear();
    updateDictionary('mdict:abc', { name: 'New title' });

    expect(mockPublishDictionaryUpsert).toHaveBeenCalledOnce();
    expect(mockPublishDictionaryUpsert.mock.calls[0]![0]).toMatchObject({
      name: 'New title',
      reincarnation: 'epoch-1',
    });
  });
});
