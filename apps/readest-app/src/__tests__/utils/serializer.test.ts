import { describe, expect, it } from 'vitest';
import {
  BOOK_CONFIG_SCHEMA_VERSION,
  BookConfig,
  BookSearchConfig,
  ViewSettings,
} from '@/types/book';
import { deserializeConfig, serializeConfig, serializeRawConfig } from '@/utils/serializer';

const globalViewSettings = {
  zoomLevel: 100,
  scrolled: false,
} as ViewSettings;

const defaultSearchConfig = {
  scope: 'book',
  matchCase: false,
  matchWholeWords: false,
  matchDiacritics: false,
} as BookSearchConfig;

describe('BookConfig serialization', () => {
  it('writes schemaVersion to settings-aware config JSON using camelCase', () => {
    const config: BookConfig = {
      updatedAt: 123,
      rsvpPosition: { cfi: 'epubcfi(/6/4!/4/2)', wordText: 'hello' },
      viewSettings: { zoomLevel: 120 },
      searchConfig: { query: 'alice' },
    };

    const serialized = serializeConfig(config, globalViewSettings, defaultSearchConfig);
    const parsed = JSON.parse(serialized);

    expect(parsed.schemaVersion).toBe(BOOK_CONFIG_SCHEMA_VERSION);
    expect(parsed.schema_version).toBeUndefined();
    expect(parsed.rsvpPosition).toEqual({ cfi: 'epubcfi(/6/4!/4/2)', wordText: 'hello' });
    expect(parsed.viewSettings).toEqual({ zoomLevel: 120 });
    expect(parsed.searchConfig).toEqual({ query: 'alice' });
  });

  it('writes schemaVersion to raw config JSON without mutating the caller object', () => {
    const config: Partial<BookConfig> = {
      updatedAt: 456,
      progress: [10, 100],
      location: 'epubcfi(/6/8!/4/2)',
    };

    const serialized = serializeRawConfig(config);
    const parsed = JSON.parse(serialized);

    expect(parsed.schemaVersion).toBe(BOOK_CONFIG_SCHEMA_VERSION);
    expect(parsed.progress).toEqual([10, 100]);
    expect(config.schemaVersion).toBeUndefined();
  });

  it('hydrates legacy config JSON without schemaVersion', () => {
    const config = deserializeConfig(
      JSON.stringify({
        updatedAt: 789,
        location: 'epubcfi(/6/10!/4/2)',
        viewSettings: { zoomLevel: 90 },
        searchConfig: { query: 'rabbit' },
      }),
      globalViewSettings,
      defaultSearchConfig,
    );

    expect(config.schemaVersion).toBe(BOOK_CONFIG_SCHEMA_VERSION);
    expect(config.location).toBe('epubcfi(/6/10!/4/2)');
    expect(config.viewSettings?.zoomLevel).toBe(90);
    expect(config.searchConfig?.query).toBe('rabbit');
  });
});
