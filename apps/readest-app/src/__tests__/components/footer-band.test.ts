import { describe, expect, it } from 'vitest';

import { footerInfoVisible, footerReservesBand } from '@/app/reader/utils/footerBand';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

// The book layout reserves a full-width bottom band (marginBottomPx tall of
// scroll padding) for the footer. That band read as a "solid bar" across the
// bottom of the screen: in scrolled mode the text clips hard at its edge, and
// tap-toggling the info off left the empty band behind. The rules now:
//   - scrolled mode never reserves the band; the info floats over the text
//     in shrink-wrapped pills instead
//   - paginated mode reserves it only while the footer displays something
//   - the sticky progress bar (always-visible, display-only) keeps its band
const settings = (overrides: Partial<ViewSettings>): ViewSettings =>
  ({ ...DEFAULT_VIEW_CONFIG, ...overrides }) as ViewSettings;

describe('footerInfoVisible', () => {
  it('is true with default settings (progress info shown)', () => {
    expect(footerInfoVisible(settings({}))).toBe(true);
  });

  it("is false when tap-to-toggle cycled the mode to 'none'", () => {
    expect(footerInfoVisible(settings({ progressInfoMode: 'none' }))).toBe(false);
  });

  it('is false when every footer widget is disabled in settings', () => {
    expect(
      footerInfoVisible(
        settings({
          progressInfoMode: 'all',
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(false);
  });

  it('respects partial modes: only widgets both in-mode and enabled count', () => {
    // mode 'time' but the clock widget is disabled -> nothing renders
    expect(
      footerInfoVisible(
        settings({ progressInfoMode: 'time', showCurrentTime: false, showProgressInfo: true }),
      ),
    ).toBe(false);
    // mode 'progress' with progress info enabled -> renders
    expect(
      footerInfoVisible(settings({ progressInfoMode: 'progress', showProgressInfo: true })),
    ).toBe(true);
  });
});

describe('footerReservesBand', () => {
  it('is false when Show Footer is off', () => {
    expect(footerReservesBand(settings({ showFooter: false }))).toBe(false);
  });

  it('reserves the band in paginated mode while info is visible', () => {
    expect(footerReservesBand(settings({ showFooter: true, scrolled: false }))).toBe(true);
  });

  it("releases the band in paginated mode when the mode is 'none'", () => {
    expect(
      footerReservesBand(settings({ showFooter: true, scrolled: false, progressInfoMode: 'none' })),
    ).toBe(false);
  });

  it('never reserves the band in scrolled mode, even with info visible', () => {
    expect(
      footerReservesBand(settings({ showFooter: true, scrolled: true, progressInfoMode: 'all' })),
    ).toBe(false);
  });

  it('keeps the band for the sticky progress bar, scrolled or not', () => {
    expect(
      footerReservesBand(
        settings({ showFooter: true, scrolled: true, showStickyProgressBar: true }),
      ),
    ).toBe(true);
    expect(
      footerReservesBand(
        settings({
          showFooter: true,
          scrolled: false,
          progressInfoMode: 'none',
          showStickyProgressBar: true,
        }),
      ),
    ).toBe(true);
  });
});
