import { describe, it, expect } from 'vitest';

import { getBaseFontFamily } from '@/utils/style';
import { ViewSettings } from '@/types/book';
import { DEFAULT_BOOK_FONT } from '@/services/constants';

/** Build a minimal ViewSettings carrying just the font fields under test. */
function makeFontSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    ...DEFAULT_BOOK_FONT,
    ...overrides,
  } as ViewSettings;
}

describe('getBaseFontFamily', () => {
  it('returns the serif chain when defaultFont is "Serif"', () => {
    const vs = makeFontSettings({ defaultFont: 'Serif', serifFont: 'Bitter' });
    const family = getBaseFontFamily(vs);
    // The chosen serif typeface leads the chain and it ends with the generic.
    expect(family.trimStart().startsWith('"Bitter"')).toBe(true);
    expect(family.trimEnd().endsWith('serif')).toBe(true);
    expect(family).not.toContain('sans-serif"');
  });

  it('returns the sans-serif chain when defaultFont is "Sans-serif"', () => {
    const vs = makeFontSettings({ defaultFont: 'Sans-serif', sansSerifFont: 'Roboto' });
    const family = getBaseFontFamily(vs);
    expect(family.trimStart().startsWith('"Roboto"')).toBe(true);
    expect(family.trimEnd().endsWith('sans-serif')).toBe(true);
  });

  it('places a custom serif font at the head of the chain', () => {
    const vs = makeFontSettings({ defaultFont: 'Serif', serifFont: 'My Custom Font' });
    const family = getBaseFontFamily(vs);
    expect(family.trimStart().startsWith('"My Custom Font"')).toBe(true);
  });

  it('includes the CJK font in the resolved chain', () => {
    const vs = makeFontSettings({
      defaultFont: 'Serif',
      serifFont: 'Bitter',
      defaultCJKFont: 'Source Han Serif CN',
    });
    const family = getBaseFontFamily(vs);
    expect(family).toContain('"Source Han Serif CN"');
  });
});
