import { describe, expect, it } from 'vitest';
import { migrateHighlightColorPrefs } from '@/services/settingsService';
import type { ReadSettings } from '@/types/settings';

const baseRead = (): ReadSettings =>
  ({
    customHighlightColors: {},
    userHighlightColors: [],
    defaultHighlightLabels: {},
  }) as unknown as ReadSettings;

describe('migrateHighlightColorPrefs', () => {
  it('lifts legacy string[] userHighlightColors into {hex} entries', () => {
    const read = baseRead();
    (read as unknown as { userHighlightColors: unknown }).userHighlightColors = [
      '#AABBCC',
      '#112233',
    ];

    migrateHighlightColorPrefs(read);

    expect(read.userHighlightColors).toEqual([{ hex: '#aabbcc' }, { hex: '#112233' }]);
  });

  it('preserves already-migrated entries', () => {
    const read = baseRead();
    read.userHighlightColors = [{ hex: '#abcdef', label: 'Keep me' }, { hex: '#123456' }];

    migrateHighlightColorPrefs(read);

    expect(read.userHighlightColors).toEqual([
      { hex: '#abcdef', label: 'Keep me' },
      { hex: '#123456' },
    ]);
  });

  it('filters out entries with malformed hex values', () => {
    const read = baseRead();
    (read as unknown as { userHighlightColors: unknown }).userHighlightColors = [
      '#abcdef',
      'not-a-hex',
      '',
      null,
    ];

    migrateHighlightColorPrefs(read);

    expect(read.userHighlightColors).toEqual([{ hex: '#abcdef' }]);
  });

  it('folds draft highlightColorLabels hex entries into matching user colors', () => {
    const read = baseRead();
    (read as unknown as { userHighlightColors: unknown }).userHighlightColors = ['#aabbcc'];
    (read as unknown as { highlightColorLabels: unknown }).highlightColorLabels = {
      '#aabbcc': 'Romance',
    };

    migrateHighlightColorPrefs(read);

    expect(read.userHighlightColors).toEqual([{ hex: '#aabbcc', label: 'Romance' }]);
    expect(
      (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels,
    ).toBeUndefined();
  });

  it('folds draft highlightColorLabels named entries into defaultHighlightLabels', () => {
    const read = baseRead();
    (read as unknown as { highlightColorLabels: unknown }).highlightColorLabels = {
      yellow: 'Foreshadowing',
      red: 'Questions',
      noise: 'Ignored',
    };

    migrateHighlightColorPrefs(read);

    expect(read.defaultHighlightLabels).toEqual({
      yellow: 'Foreshadowing',
      red: 'Questions',
    });
    expect(
      (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels,
    ).toBeUndefined();
  });

  it('does not overwrite an already-set defaultHighlightLabel', () => {
    const read = baseRead();
    read.defaultHighlightLabels = { yellow: 'Existing' };
    (read as unknown as { highlightColorLabels: unknown }).highlightColorLabels = {
      yellow: 'Legacy',
    };

    migrateHighlightColorPrefs(read);

    expect(read.defaultHighlightLabels).toEqual({ yellow: 'Existing' });
  });
});
