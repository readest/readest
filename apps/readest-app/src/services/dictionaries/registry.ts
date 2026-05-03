/**
 * Dictionary provider registry.
 *
 * Returns the ordered list of {@link DictionaryProvider} instances visible
 * in the lookup popup, given the user's current `dictionarySettings` (order,
 * enable flags), the imported-dictionary metadata, and the filesystem
 * accessor used by import-backed providers (StarDict / MDict) to lazily open
 * their bundle files.
 *
 * Provider instances are cached at module scope (keyed by id) so subsequent
 * lookups within the same session reuse parsed indexes / object URLs. This
 * cache is **not** in zustand: provider instances and their object URLs are
 * runtime-only and non-serializable; storing them alongside metadata would
 * pollute the synced settings shape.
 */
import type {
  DictionaryProvider,
  DictionarySettings,
  ImportedDictionary,
  WebSearchEntry,
} from './types';
import { BUILTIN_PROVIDER_IDS } from './types';
import { wiktionaryProvider } from './providers/wiktionaryProvider';
import { wikipediaProvider } from './providers/wikipediaProvider';
import { createStarDictProvider, type DictionaryFileOpener } from './providers/starDictProvider';
import { createMdictProvider } from './providers/mdictProvider';
import { createDictProvider } from './providers/dictProvider';
import { createSlobProvider } from './providers/slobProvider';
import { createWebSearchProvider } from './providers/webSearchProvider';
import { getBuiltinWebSearch } from './webSearchTemplates';

const instanceCache = new Map<string, DictionaryProvider>();

interface RegistryArgs {
  settings: DictionarySettings;
  dictionaries: ImportedDictionary[];
  /**
   * Required when the provider order contains imported (stardict / mdict)
   * dictionaries — their providers open files via this accessor on first
   * lookup. Builtin-only callers (e.g. tests) may omit it.
   */
  fs?: DictionaryFileOpener;
}

const builtinFor = (id: string): DictionaryProvider | undefined => {
  if (id === BUILTIN_PROVIDER_IDS.wiktionary) return wiktionaryProvider;
  if (id === BUILTIN_PROVIDER_IDS.wikipedia) return wikipediaProvider;
  return undefined;
};

/**
 * Resolve a `web:*` id to its template — built-in if id starts with
 * `web:builtin:`, else look it up in `settings.webSearches`.
 */
const findWebTemplate = (id: string, settings: DictionarySettings): WebSearchEntry | undefined => {
  if (id.startsWith('web:builtin:')) return getBuiltinWebSearch(id);
  const list = settings.webSearches ?? [];
  const tpl = list.find((t) => t.id === id);
  if (!tpl || tpl.deletedAt) return undefined;
  return tpl;
};

const getOrCreate = (
  id: string,
  dict: ImportedDictionary | undefined,
  fs: DictionaryFileOpener | undefined,
  settings: DictionarySettings,
): DictionaryProvider | undefined => {
  const cached = instanceCache.get(id);
  if (cached) return cached;
  const builtin = builtinFor(id);
  if (builtin) {
    instanceCache.set(id, builtin);
    return builtin;
  }
  if (id.startsWith('web:')) {
    const tpl = findWebTemplate(id, settings);
    if (!tpl) return undefined;
    const provider = createWebSearchProvider({ template: tpl });
    instanceCache.set(id, provider);
    return provider;
  }
  if (!dict) return undefined;
  if (!fs) return undefined;
  if (dict.kind === 'stardict') {
    const provider = createStarDictProvider({ dict, fs });
    instanceCache.set(id, provider);
    return provider;
  }
  if (dict.kind === 'mdict') {
    const provider = createMdictProvider({ dict, fs });
    instanceCache.set(id, provider);
    return provider;
  }
  if (dict.kind === 'dict') {
    const provider = createDictProvider({ dict, fs });
    instanceCache.set(id, provider);
    return provider;
  }
  if (dict.kind === 'slob') {
    const provider = createSlobProvider({ dict, fs });
    instanceCache.set(id, provider);
    return provider;
  }
  return undefined;
};

/**
 * Returns the ordered list of enabled providers ready for the popup.
 * - Filters out disabled ids.
 * - Filters out imported entries that are soft-deleted, unavailable on this
 *   device, or flagged unsupported.
 * - Preserves the order in `settings.providerOrder`.
 */
export const getEnabledProviders = ({
  settings,
  dictionaries,
  fs,
}: RegistryArgs): DictionaryProvider[] => {
  const dictById = new Map(dictionaries.map((d) => [d.id, d]));
  const out: DictionaryProvider[] = [];
  for (const id of settings.providerOrder) {
    if (settings.providerEnabled[id] === false) continue;
    if (id.startsWith('builtin:')) {
      const provider = getOrCreate(id, undefined, undefined, settings);
      if (provider) out.push(provider);
      continue;
    }
    if (id.startsWith('web:')) {
      const provider = getOrCreate(id, undefined, undefined, settings);
      if (provider) out.push(provider);
      continue;
    }
    const dict = dictById.get(id);
    if (!dict) continue;
    if (dict.deletedAt || dict.unavailable || dict.unsupported) continue;
    const provider = getOrCreate(id, dict, fs, settings);
    if (provider) out.push(provider);
  }
  return out;
};

/** Drop a single provider from the cache (e.g. after dictionary deletion). */
export const evictProvider = (id: string): void => {
  const cached = instanceCache.get(id);
  cached?.dispose?.();
  instanceCache.delete(id);
};

/** Drop everything. Test helper. */
export const __resetRegistryForTests = (): void => {
  for (const [, provider] of instanceCache) provider.dispose?.();
  instanceCache.clear();
};
