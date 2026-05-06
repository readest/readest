import { create } from 'zustand';
import { EnvConfigType } from '@/services/environment';
import type {
  DictionarySettings,
  ImportedDictionary,
  WebSearchEntry,
} from '@/services/dictionaries/types';
import { BUILTIN_PROVIDER_IDS, BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';
import { useSettingsStore } from './settingsStore';

/**
 * Built-in web-search ids are seeded into `providerOrder` but disabled by
 * default — users opt in. This preserves the principle that we don't push
 * users onto external pages without consent, while still surfacing the
 * options in the settings list.
 */
const BUILTIN_WEB_ORDER = [
  BUILTIN_WEB_SEARCH_IDS.google,
  BUILTIN_WEB_SEARCH_IDS.urban,
  BUILTIN_WEB_SEARCH_IDS.merriamWebster,
];

const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
  providerOrder: [
    BUILTIN_PROVIDER_IDS.wiktionary,
    BUILTIN_PROVIDER_IDS.wikipedia,
    ...BUILTIN_WEB_ORDER,
  ],
  providerEnabled: {
    [BUILTIN_PROVIDER_IDS.wiktionary]: true,
    [BUILTIN_PROVIDER_IDS.wikipedia]: true,
    [BUILTIN_WEB_SEARCH_IDS.google]: false,
    [BUILTIN_WEB_SEARCH_IDS.urban]: false,
    [BUILTIN_WEB_SEARCH_IDS.merriamWebster]: false,
  },
  webSearches: [],
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
  /**
   * Patch an imported dictionary's mutable display fields (currently just
   * `name`). The on-disk bundle is untouched. No-op if the id is unknown
   * or refers to a deleted entry.
   */
  updateDictionary(id: string, patch: { name?: string }): void;
  /**
   * Drop one or more existing dictionaries by id and insert `newDict` in
   * the first removed entry's slot in `providerOrder`, inheriting that
   * entry's enabled flag. Used by the importer when a re-imported dict
   * matches an existing one (or several) by name.
   */
  replaceDictionaries(oldIds: string[], newDict: ImportedDictionary): void;
  /** Soft-delete an imported entry by id; remove from providerOrder + providerEnabled. */
  removeDictionary(id: string): boolean;
  /** Replace a subset of provider ids in providerOrder; ignores unknown ids. */
  reorder(ids: string[]): void;
  /** Toggle a provider's enabled flag. Both builtin and imported ids are accepted. */
  setEnabled(id: string, enabled: boolean): void;
  /** Persist the last-used tab id so the popup re-opens on it. */
  setDefaultProviderId(id: string | undefined): void;

  /** Add a custom web search (id is generated). Appended + enabled by default. */
  addWebSearch(name: string, urlTemplate: string): WebSearchEntry;
  /** Update an existing custom web search; no-op if id is unknown or built-in. */
  updateWebSearch(id: string, patch: { name?: string; urlTemplate?: string }): void;
  /** Soft-delete a custom web search and remove from order/enabled. */
  removeWebSearch(id: string): boolean;

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

  updateDictionary: (id, patch) => {
    set((state) => {
      const idx = state.dictionaries.findIndex((d) => d.id === id);
      if (idx < 0) return state;
      const old = state.dictionaries[idx]!;
      if (old.deletedAt) return state;
      const trimmedName = patch.name?.trim();
      // Reject undefined (no patch), empty (would clear the label), and
      // unchanged (no-op).
      if (!trimmedName || trimmedName === old.name) return state;
      const dictionaries = state.dictionaries.map((d, i) =>
        i === idx ? { ...d, name: trimmedName } : d,
      );
      return { dictionaries };
    });
  },

  replaceDictionaries: (oldIds, newDict) => {
    if (oldIds.length === 0) {
      get().addDictionary(newDict);
      return;
    }
    const oldIdSet = new Set(oldIds);
    set((state) => {
      // Drop all old entries (hard-remove since the disk bundles are gone)
      // and append the new one. Soft-delete isn't needed: the previously
      // stored entries are no longer recoverable.
      const dictionaries = state.dictionaries.filter((d) => !oldIdSet.has(d.id));
      dictionaries.push(newDict);

      // Splice the new id into providerOrder at the first old slot. Drop
      // any further old slots.
      const oldOrder = state.settings.providerOrder;
      const providerOrder: string[] = [];
      let inserted = false;
      for (const id of oldOrder) {
        if (oldIdSet.has(id)) {
          if (!inserted) {
            providerOrder.push(newDict.id);
            inserted = true;
          }
        } else {
          providerOrder.push(id);
        }
      }
      if (!inserted) providerOrder.push(newDict.id);

      // Inherit the first old entry's enabled flag (default to !unsupported
      // if the old wasn't recorded).
      const firstOldId = oldIds[0]!;
      const inheritedEnabled =
        state.settings.providerEnabled[firstOldId] !== undefined
          ? state.settings.providerEnabled[firstOldId] !== false
          : !newDict.unsupported;
      const providerEnabled = { ...state.settings.providerEnabled };
      for (const oldId of oldIds) delete providerEnabled[oldId];
      providerEnabled[newDict.id] = inheritedEnabled;

      return {
        dictionaries,
        settings: { ...state.settings, providerOrder, providerEnabled },
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

  addWebSearch: (name, urlTemplate) => {
    const trimmedName = name.trim();
    const trimmedUrl = urlTemplate.trim();
    const id = `web:${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const entry: WebSearchEntry = { id, name: trimmedName, urlTemplate: trimmedUrl };
    set((state) => {
      const list = state.settings.webSearches ?? [];
      const order = state.settings.providerOrder.includes(id)
        ? state.settings.providerOrder
        : [...state.settings.providerOrder, id];
      const enabled = { ...state.settings.providerEnabled, [id]: true };
      return {
        settings: {
          ...state.settings,
          webSearches: [...list, entry],
          providerOrder: order,
          providerEnabled: enabled,
        },
      };
    });
    return entry;
  },

  updateWebSearch: (id, patch) => {
    if (id.startsWith('web:builtin:')) return;
    set((state) => {
      const list = state.settings.webSearches ?? [];
      if (!list.some((t) => t.id === id)) return state;
      const next = list.map((t) =>
        t.id === id
          ? {
              ...t,
              name: patch.name?.trim() ?? t.name,
              urlTemplate: patch.urlTemplate?.trim() ?? t.urlTemplate,
            }
          : t,
      );
      return { settings: { ...state.settings, webSearches: next } };
    });
  },

  removeWebSearch: (id) => {
    if (id.startsWith('web:builtin:')) return false;
    const list = get().settings.webSearches ?? [];
    if (!list.some((t) => t.id === id)) return false;
    set((state) => ({
      settings: {
        ...state.settings,
        webSearches: (state.settings.webSearches ?? []).map((t) =>
          t.id === id ? { ...t, deletedAt: Date.now() } : t,
        ),
        providerOrder: state.settings.providerOrder.filter((p) => p !== id),
        providerEnabled: Object.fromEntries(
          Object.entries(state.settings.providerEnabled).filter(([k]) => k !== id),
        ),
      },
    }));
    return true;
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
      // For providerOrder, we append any newly-defaulted ids (like the
      // built-in web searches added in this release) so existing users see
      // them appear at the end of the list.
      const persistedOrder = persistedSettings.providerOrder;
      const orderSet = new Set(persistedOrder);
      const merged: string[] = persistedOrder.length
        ? [...persistedOrder]
        : [...DEFAULT_DICTIONARY_SETTINGS.providerOrder];
      for (const id of DEFAULT_DICTIONARY_SETTINGS.providerOrder) {
        if (!orderSet.has(id)) merged.push(id);
      }
      const settingsMerged: DictionarySettings = {
        providerOrder: merged,
        providerEnabled: {
          ...DEFAULT_DICTIONARY_SETTINGS.providerEnabled,
          ...persistedSettings.providerEnabled,
        },
        defaultProviderId: persistedSettings.defaultProviderId,
        webSearches: persistedSettings.webSearches ?? [],
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
