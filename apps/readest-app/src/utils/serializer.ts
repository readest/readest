import {
  BOOK_CONFIG_SCHEMA_VERSION,
  BookConfig,
  BookSearchConfig,
  ViewSettings,
} from '@/types/book';

export const stampBookConfigSchema = <T extends Partial<BookConfig>>(config: T): T => {
  return { ...config, schemaVersion: BOOK_CONFIG_SCHEMA_VERSION };
};

export const serializeRawConfig = (config: Partial<BookConfig>): string => {
  return JSON.stringify(stampBookConfigSchema(config));
};

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
      if (globalViewSettings[key as keyof ViewSettings] !== value) {
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
