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

  it('migrates legacy split annotations on load when schemaVersion < 2', () => {
    const config = deserializeConfig(
      JSON.stringify({
        updatedAt: 1,
        booknotes: [
          {
            id: 'h',
            type: 'annotation',
            cfi: 'C1',
            style: 'highlight',
            color: 'yellow',
            text: 't',
            note: '',
            createdAt: 10,
            updatedAt: 10,
          },
          {
            id: 'n',
            type: 'annotation',
            cfi: 'C1',
            text: 't',
            note: 'hello',
            createdAt: 20,
            updatedAt: 20,
          },
        ],
      }),
      globalViewSettings,
      defaultSearchConfig,
    );
    const survivor = config.booknotes!.find((n) => n.id === 'h')!;
    const tombstone = config.booknotes!.find((n) => n.id === 'n')!;
    expect(survivor.note).toBe('hello');
    expect(survivor.deletedAt).toBeFalsy();
    expect(tombstone.deletedAt).toBeTruthy();
  });

  it('does not persist an array view setting that equals the global value', () => {
    // Array/object view settings must be compared by value, not reference —
    // otherwise annotationToolbarItems (an array) is stored as a per-book override on
    // every save, shadowing later global changes (the customize-toolbar bug).
    const global = {
      ...globalViewSettings,
      annotationToolbarItems: ['highlight', 'annotate', 'copy'],
    } as unknown as ViewSettings;
    const config: BookConfig = {
      updatedAt: 1,
      // Same content as global but a distinct array reference, as produced by the
      // load -> merge -> serialize round-trip.
      viewSettings: {
        annotationToolbarItems: ['highlight', 'annotate', 'copy'],
      } as Partial<ViewSettings>,
    };

    const parsed = JSON.parse(serializeConfig(config, global, defaultSearchConfig));

    expect(parsed.viewSettings.annotationToolbarItems).toBeUndefined();
  });

  it('persists an array view setting that differs from the global value', () => {
    const global = {
      ...globalViewSettings,
      annotationToolbarItems: ['highlight', 'annotate', 'copy'],
    } as unknown as ViewSettings;
    const config: BookConfig = {
      updatedAt: 1,
      viewSettings: { annotationToolbarItems: ['copy'] } as Partial<ViewSettings>,
    };

    const parsed = JSON.parse(serializeConfig(config, global, defaultSearchConfig));

    expect(parsed.viewSettings.annotationToolbarItems).toEqual(['copy']);
  });

  it('migrates v2 search config: matchWholeWords:true -> mode "whole-words"', () => {
    const config = deserializeConfig(
      JSON.stringify({ schemaVersion: 2, searchConfig: { matchWholeWords: true } }),
      globalViewSettings,
      defaultSearchConfig,
    );
    const sc = config.searchConfig as BookSearchConfig;
    expect(sc.mode).toBe('whole-words');
    expect(sc.matchWholeWords).toBe(true);
    expect(sc.nearbyWords).toBe(10);
  });

  it('migrates v2 search config: matchWholeWords:false -> mode "contains"', () => {
    const config = deserializeConfig(
      JSON.stringify({ schemaVersion: 2, searchConfig: { matchWholeWords: false } }),
      globalViewSettings,
      defaultSearchConfig,
    );
    const sc = config.searchConfig as BookSearchConfig;
    expect(sc.mode).toBe('contains');
    expect(sc.matchWholeWords).toBe(false);
  });

  it('preserves an explicit mode and mirrors the deprecated boolean', () => {
    const config = deserializeConfig(
      JSON.stringify({ schemaVersion: 3, searchConfig: { mode: 'regex' } }),
      globalViewSettings,
      defaultSearchConfig,
    );
    const sc = config.searchConfig as BookSearchConfig;
    expect(sc.mode).toBe('regex');
    expect(sc.matchWholeWords).toBe(false);
  });

  it('does not migrate annotations when schemaVersion is already 2', () => {
    const config = deserializeConfig(
      JSON.stringify({
        schemaVersion: 2,
        booknotes: [
          {
            id: 'h',
            type: 'annotation',
            cfi: 'C1',
            style: 'highlight',
            note: '',
            createdAt: 10,
            updatedAt: 10,
          },
          {
            id: 'n',
            type: 'annotation',
            cfi: 'C1',
            note: 'hello',
            createdAt: 20,
            updatedAt: 20,
          },
        ],
      }),
      globalViewSettings,
      defaultSearchConfig,
    );
    expect(config.booknotes!.every((n) => !n.deletedAt)).toBe(true);
  });
});
