// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { footerInfoVisible, footerReservesBand } from '@/app/reader/utils/footerBand';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const settings = (overrides: Partial<ViewSettings>): ViewSettings =>
  ({ ...DEFAULT_VIEW_CONFIG, ...overrides }) as ViewSettings;

describe('footerInfoVisible', () => {
  it('is true with default settings (progress info shown)', () => {
    expect(footerInfoVisible(settings({}))).toBe(true);
  });

  it('is false when every footer widget is disabled in settings', () => {
    expect(
      footerInfoVisible(
        settings({
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(false);
  });

  it('is true when any single widget is enabled', () => {
    expect(
      footerInfoVisible(
        settings({
          showRemainingTime: false,
          showRemainingPages: true,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(true);
  });
});

describe('footerReservesBand', () => {
  it('releases the band when Show Footer is off, even with the progress bar enabled', () => {
    expect(footerReservesBand(settings({ showFooter: false, showStickyProgressBar: true }))).toBe(
      false,
    );
  });

  it.each([false, true])('reserves the band without a progress bar (scrolled: %s)', (scrolled) => {
    expect(
      footerReservesBand(settings({ showFooter: true, scrolled, showStickyProgressBar: false })),
    ).toBe(true);
  });

  it.each([false, true])('keeps an empty footer band (scrolled: %s)', (scrolled) => {
    expect(
      footerReservesBand(
        settings({
          showFooter: true,
          scrolled,
          showStickyProgressBar: false,
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(true);
  });

  it('keeps a vertical footer beside the page', () => {
    expect(footerReservesBand(settings({ showFooter: true, vertical: true }))).toBe(false);
  });
});
