import { create } from 'zustand';
import { EnvConfigType } from '@/services/environment';
import type { DictionarySettings, ImportedDictionary } from '@/services/dictionaries/types';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import { useSettingsStore } from './settingsStore';

const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
  providerOrder: [BUILTIN_PROVIDER_IDS.wiktionary, BUILTIN_PROVIDER_IDS.wikipedia],
  providerEnabled: {
    [BUILTIN_PROVIDER_IDS.wiktionary]: true,
    [BUILTIN_PROVIDER_IDS.wikipedia]: true,
  },
};

interface DictionaryStoreState {
  /** Imported (non-builtin) dictionaries. Soft-deleted entries are kept until next save. */
  dictionaries: ImportedDictionary[];
  settings: DictionarySettings;

  /** Imported entries currently visible (not soft-deleted, sorted by addedAt desc). */
  getAvailableDictionaries(): ImportedDictionary[];
  getDictionary(id: string): ImportedDictionary | undefined;

  /** Add (or revive) an imported dictionary. New entries are appended to providerOrder + enabled. */
  addDictionary(dict: ImportedDictionary): void;
  /** Soft-delete an imported entry by id; remove from providerOrder + providerEnabled. */
  removeDictionary(id: string): boolean;
  /** Replace a subset of provider ids in providerOrder; ignores unknown ids. */
  reorder(ids: string[]): void;
  /** Toggle a provider's enabled flag. Both builtin and imported ids are accepted. */
  setEnabled(id: string, enabled: boolean): void;
  /** Persist the last-used tab id so the popup re-opens on it. */
  setDefaultProviderId(id: string | undefined): void;

  /** Hydrate from `settings.customDictionaries` + `settings.dictionarySettings` + check on-disk availability. */
  loadCustomDictionaries(envConfig: EnvConfigType): Promise<void>;
  /** Persist current state back into settings (which then syncs to cloud). */
  saveCustomDictionaries(envConfig: EnvConfigType): Promise<void>;
}

function toSettingsDict(dict: ImportedDictionary): ImportedDictionary {
  // Strip transient fields before persisting. `unavailable` is recomputed at
  // load time from the actual filesystem state, so don't write it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { unavailable: _u, ...rest } = dict;
  return rest;
}

export const useCustomDictionaryStore = create<DictionaryStoreState>((set, get) => ({
  dictionaries: [],
  settings: { ...DEFAULT_DICTIONARY_SETTINGS },

  getAvailableDictionaries: () =>
    get()
      .dictionaries.filter((d) => !d.deletedAt)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),

  getDictionary: (id) => get().dictionaries.find((d) => d.id === id),

  addDictionary: (dict) => {
    set((state) => {
      const existingIdx = state.dictionaries.findIndex((d) => d.id === dict.id);
      const dictionaries =
        existingIdx >= 0
          ? state.dictionaries.map((d, i) =>
              i === existingIdx ? { ...dict, deletedAt: undefined } : d,
            )
          : [...state.dictionaries, dict];
      const order = state.settings.providerOrder.includes(dict.id)
        ? state.settings.providerOrder
        : [...state.settings.providerOrder, dict.id];
      const enabled = { ...state.settings.providerEnabled };
      if (!(dict.id in enabled)) enabled[dict.id] = !dict.unsupported;
      return {
        dictionaries,
        settings: { ...state.settings, providerOrder: order, providerEnabled: enabled },
      };
    });
  },

  removeDictionary: (id) => {
    const dict = get().dictionaries.find((d) => d.id === id);
    if (!dict) return false;
    set((state) => ({
      dictionaries: state.dictionaries.map((d) =>
        d.id === id ? { ...d, deletedAt: Date.now() } : d,
      ),
      settings: {
        ...state.settings,
        providerOrder: state.settings.providerOrder.filter((p) => p !== id),
        providerEnabled: Object.fromEntries(
          Object.entries(state.settings.providerEnabled).filter(([k]) => k !== id),
        ),
      },
    }));
    return true;
  },

  reorder: (ids) => {
    set((state) => {
      // Keep only ids that still exist; tail any known ids missing from the input.
      const known = new Set(state.settings.providerOrder);
      const filtered = ids.filter((id) => known.has(id));
      const tail = state.settings.providerOrder.filter((id) => !filtered.includes(id));
      return {
        settings: { ...state.settings, providerOrder: [...filtered, ...tail] },
      };
    });
  },

  setEnabled: (id, enabled) => {
    set((state) => ({
      settings: {
        ...state.settings,
        providerEnabled: { ...state.settings.providerEnabled, [id]: enabled },
      },
    }));
  },

  setDefaultProviderId: (id) => {
    set((state) => ({
      settings: { ...state.settings, defaultProviderId: id },
    }));
  },

  loadCustomDictionaries: async (envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const persisted = settings?.customDictionaries ?? [];
      const persistedSettings = settings?.dictionarySettings ?? DEFAULT_DICTIONARY_SETTINGS;
      const appService = await envConfig.getAppService();
      const dictionaries = await Promise.all(
        persisted.map(async (dict) => {
          if (dict.deletedAt) return dict;
          const exists = await appService.exists(dict.bundleDir, 'Dictionaries');
          return exists ? dict : { ...dict, unavailable: true };
        }),
      );
      // Merge defaults to back-fill any missing keys (e.g. new builtin added in a release).
      const settingsMerged: DictionarySettings = {
        providerOrder: persistedSettings.providerOrder.length
          ? persistedSettings.providerOrder
          : DEFAULT_DICTIONARY_SETTINGS.providerOrder,
        providerEnabled: {
          ...DEFAULT_DICTIONARY_SETTINGS.providerEnabled,
          ...persistedSettings.providerEnabled,
        },
        defaultProviderId: persistedSettings.defaultProviderId,
      };
      set({ dictionaries, settings: settingsMerged });
    } catch (error) {
      console.error('Failed to load custom dictionaries settings:', error);
    }
  },

  saveCustomDictionaries: async (envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { dictionaries, settings: dictSettings } = get();
      settings.customDictionaries = dictionaries.map(toSettingsDict);
      settings.dictionarySettings = dictSettings;
      setSettings(settings);
      saveSettings(envConfig, settings);
    } catch (error) {
      console.error('Failed to save custom dictionaries settings:', error);
      throw error;
    }
  },
}));
