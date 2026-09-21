import { describe, expect, it } from 'vitest';
import type { BookshelfDefinition, BookshelfState } from '@/types/bookshelf';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { HlcGenerator } from '@/libs/crdt';
import { createBookshelf, defaultBookshelves } from '@/services/bookshelves/definitions';
import { applyBookshelfDraft } from '@/services/bookshelves/state';
import { DEFAULT_SYSTEM_SETTINGS as partialSettings } from '@/services/constants';

const clock = new HlcGenerator('settings-store');
const baseSettings = partialSettings as SystemSettings;
const defaults = defaultBookshelves(baseSettings);
const draftState = (base: BookshelfDefinition[], draft: BookshelfDefinition[]): BookshelfState =>
  applyBookshelfDraft({ rows: {} }, base, draft, {
    userId: '',
    deviceId: 'store',
    next: () => clock.next(),
  }).state;
const settingsWith = (bookshelves: BookshelfState): SystemSettings => ({
  ...baseSettings,
  bookshelves,
});

describe('settings store bookshelf merging', () => {
  it('keeps the stored bookshelf state when an unrelated field is written', () => {
    useSettingsStore.getState().setSettings(settingsWith(draftState([], defaults)));
    const stored = useSettingsStore.getState().settings.bookshelves;
    useSettingsStore
      .getState()
      .setSettings({ ...useSettingsStore.getState().settings, libraryColumns: 5 });
    expect(useSettingsStore.getState().settings.bookshelves).toBe(stored);
  });
  it('merges a genuinely different incoming bookshelf state', () => {
    const custom = createBookshelf('Custom');
    useSettingsStore.getState().setSettings(settingsWith(draftState([], defaults)));
    useSettingsStore
      .getState()
      .setSettings(settingsWith(draftState(defaults, [custom, ...defaults])));
    const rows = useSettingsStore.getState().settings.bookshelves!.rows;
    expect(rows[custom.id]?.fields_jsonb['definition']).toBeTruthy();
    expect(rows['default']?.fields_jsonb['definition']).toBeTruthy();
  });
});
