import { describe, expect, it } from 'vitest';
import { getViewInsets } from '@/utils/insets';
import type { ViewSettings } from '@/types/book';

const viewSettings = (vertical: boolean) =>
  ({
    vertical,
    writingMode: 'auto',
    showHeader: true,
    showFooter: true,
    marginTopPx: 44,
    marginRightPx: 36,
    marginBottomPx: 40,
    marginLeftPx: 32,
    compactMarginTopPx: 14,
    compactMarginRightPx: 12,
    compactMarginBottomPx: 10,
    compactMarginLeftPx: 8,
  }) as ViewSettings;

describe('getViewInsets writing axes', () => {
  it('uses full top and bottom bands for horizontal writing', () => {
    expect(getViewInsets(viewSettings(false))).toEqual({
      top: 44,
      right: 12,
      bottom: 40,
      left: 8,
    });
  });

  it('uses compact top and bottom margins for vertical writing', () => {
    expect(getViewInsets(viewSettings(true))).toEqual({
      top: 14,
      right: 36,
      bottom: 10,
      left: 32,
    });
  });
});
