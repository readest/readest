import {
  BOOK_CONFIG_SCHEMA_VERSION,
  BookConfig,
  BookSearchConfig,
  ViewSettings,
} from '@/types/book';
import { unifyAnnotations } from '@/utils/booknoteMigration';
import { DEFAULT_NEARBY_WORDS, ensureSearchMode, modeToWholeWords } from '@/utils/searchConfig';

export const stampBookConfigSchema = <T extends Partial<BookConfig>>(config: T): T => {
  return { ...config, schemaVersion: BOOK_CONFIG_SCHEMA_VERSION };
};

export const serializeRawConfig = (config: Partial<BookConfig>): string => {
  return JSON.stringify(stampBookConfigSchema(config));
};

// Compare a per-book view-setting value with the global one by value, not
// reference. serializeConfig deep-clones the config first, so array/object
// settings (e.g. annotationToolbarItems) are always fresh references; a reference
// check would persist them as per-book overrides even when identical to global,
// which then shadows later global changes on reopen. Primitives short-circuit;
// the JSON compare covers arrays and plain config objects (all JSON-serializable).
const isSameViewSettingValue = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export const serializeConfig = (
  config: BookConfig,
  globalViewSettings: ViewSettings,
  defaultSearchConfig: BookSearchConfig,
): string => {
  config = JSON.parse(JSON.stringify(config));
  // Tolerate configs that arrive without these fields. Two real-world
  // call sites can produce that shape:
  //   1. A freshly-initialised config (`INIT_BOOK_CONFIG`) that has
  //      never been touched by the reader yet.
  //   2. The WebDAV sync download path, which merges `{ updatedAt: 0,
  //      booknotes: [] }` with a remote `compressConfig` payload — the
  //      latter omits viewSettings/searchConfig entirely when they
  //      match global defaults.
  // Treating null/undefined as `{}` is semantically identical to "no
  // overrides vs global", so the reduce below correctly emits an empty
  // object that downstream `deserializeConfig` re-hydrates from globals.
  const viewSettings = (config.viewSettings ?? {}) as Partial<ViewSettings>;
  const searchConfig = (config.searchConfig ?? {}) as Partial<BookSearchConfig>;
  config.viewSettings = Object.entries(viewSettings).reduce(
    (acc: Partial<Record<keyof ViewSettings, unknown>>, [key, value]) => {
      if (!isSameViewSettingValue(globalViewSettings[key as keyof ViewSettings], value)) {
        acc[key as keyof ViewSettings] = value;
      }
      return acc;
    },
    {} as Partial<Record<keyof ViewSettings, unknown>>,
  ) as Partial<ViewSettings>;
  config.searchConfig = Object.entries(searchConfig).reduce(
    (acc: Partial<Record<keyof BookSearchConfig, unknown>>, [key, value]) => {
      if (defaultSearchConfig[key as keyof BookSearchConfig] !== value) {
        acc[key as keyof BookSearchConfig] = value;
      }
      return acc;
    },
    {} as Partial<BookSearchConfig>,
  ) as Partial<BookSearchConfig>;
  config.schemaVersion = BOOK_CONFIG_SCHEMA_VERSION;

  return JSON.stringify(config);
};

export const deserializeConfig = (
  str: string,
  globalViewSettings: ViewSettings,
  defaultSearchConfig: BookSearchConfig,
): BookConfig => {
  const config = JSON.parse(str) as BookConfig;
  const { viewSettings, searchConfig } = config;
  config.viewSettings = { ...globalViewSettings, ...viewSettings };
  config.searchConfig = { ...defaultSearchConfig, ...searchConfig };
  // v2 -> v3: search gained a `mode` enum (contains/whole-words/regex/nearby-words)
  // replacing the `matchWholeWords` boolean. Derive `mode` from the boolean when a
  // pre-v3 config (or sync peer) omits it, then keep the boolean mirrored on the wire.
  const sc = config.searchConfig as BookSearchConfig;
  sc.mode = ensureSearchMode(searchConfig ?? {});
  sc.matchWholeWords = modeToWholeWords(sc.mode);
  sc.nearbyWords ??= DEFAULT_NEARBY_WORDS;
  // v1 -> v2: collapse split highlight+note records into one unified record so a
  // note renders with its highlight and round-trips cleanly to KOReader.
  if ((config.schemaVersion ?? 0) < 2 && config.booknotes?.length) {
    config.booknotes = unifyAnnotations(config.booknotes);
  }
  config.schemaVersion ??= BOOK_CONFIG_SCHEMA_VERSION;
  config.updatedAt ??= Date.now();
  return config;
};

export const compressConfig = (
  config: BookConfig,
  globalViewSettings: ViewSettings,
  defaultSearchConfig: BookSearchConfig,
): string => {
  return JSON.parse(serializeConfig(config, globalViewSettings, defaultSearchConfig));
};
