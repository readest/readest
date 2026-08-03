import { describe, expect, it } from 'vitest';
import { migrateLibraryThenSort } from '@/services/settingsService';
import { LibrarySortByType, type SystemSettings } from '@/types/settings';

const baseSettings = (): SystemSettings =>
  ({
    libraryThenSortBy: 'none',
  }) as unknown as SystemSettings;

describe('migrateLibraryThenSort', () => {
  it('lifts a legacy librarySortBy2 pick into libraryThenSortBy', () => {
    const settings = baseSettings();
    (settings as unknown as { librarySortBy2: unknown }).librarySortBy2 = LibrarySortByType.Series;

    migrateLibraryThenSort(settings);

    expect(settings.libraryThenSortBy).toBe(LibrarySortByType.Series);
    expect((settings as unknown as { librarySortBy2?: unknown }).librarySortBy2).toBeUndefined();
  });

  it('keeps an explicit post-rename pick', () => {
    const settings = baseSettings();
    settings.libraryThenSortBy = LibrarySortByType.Title;
    (settings as unknown as { librarySortBy2: unknown }).librarySortBy2 = LibrarySortByType.Series;

    migrateLibraryThenSort(settings);

    expect(settings.libraryThenSortBy).toBe(LibrarySortByType.Title);
  });

  it('leaves settings without the legacy key untouched', () => {
    const settings = baseSettings();

    migrateLibraryThenSort(settings);

    expect(settings.libraryThenSortBy).toBe('none');
  });
});
