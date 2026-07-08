import { describe, expect, it } from 'vitest';

import { footerInfoVisible, footerReservesBand } from '@/app/reader/utils/footerBand';
import { DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

// The book layout reserves a full-width bottom band (marginBottomPx of page
// margin / scroll padding) for the footer. That band read as a "solid bar"
// across the bottom of the screen: in scrolled mode the text clipped hard at
// its edge, and it lingered even when the footer had nothing to show. Rules:
//   - scrolled mode never reserves the band; the info floats over the text
//     in shrink-wrapped pills instead
//   - paginated mode reserves it only while some widget is enabled
//   - the sticky progress bar (always-visible, display-only) keeps its band
// Tapping the footer flips showFooter off entirely (see ProgressBar), which
// unmounts the footer and releases the band through the showFooter gate.
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
  it('is false when Show Footer is off', () => {
    expect(footerReservesBand(settings({ showFooter: false }))).toBe(false);
  });

  it('reserves the band in paginated mode while info is visible', () => {
    expect(footerReservesBand(settings({ showFooter: true, scrolled: false }))).toBe(true);
  });

  it('releases the band in paginated mode when no widget is enabled', () => {
    expect(
      footerReservesBand(
        settings({
          showFooter: true,
          scrolled: false,
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(false);
  });

  it('never reserves the band in scrolled mode, even with info visible', () => {
    expect(footerReservesBand(settings({ showFooter: true, scrolled: true }))).toBe(false);
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
          showStickyProgressBar: true,
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
      ),
    ).toBe(true);
  });
});
