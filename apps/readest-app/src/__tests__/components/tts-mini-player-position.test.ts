import { describe, expect, it } from 'vitest';

import { getTTSMiniPlayerBottomOffset } from '@/app/reader/utils/ttsMiniPlayerPosition';
import { DEFAULT_BOOK_LAYOUT, DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

// The TTS mini player stays visible for the whole session and stacks above
// whatever occupies the bottom edge (offsets exclude the safe-area inset,
// which the component applies separately as margin-bottom):
//   - bottom bar shown (hoveredBookKey === bookKey): above the bar
//     (64px mobile nav bar / 52px desktop bar, + 8px gap)
//   - bottom bar dismissed: above the footer info band (marginBottomPx)
//   - no footer info at the bottom: 16px above the bottom edge
const settings = (overrides: Partial<ViewSettings>): ViewSettings =>
  ({ ...DEFAULT_VIEW_CONFIG, ...DEFAULT_BOOK_LAYOUT, ...overrides }) as ViewSettings;

describe('getTTSMiniPlayerBottomOffset', () => {
  it('sits above the mobile bottom bar while it is shown', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({}), { barVisible: true, usesMobileBar: true }),
    ).toBe(72);
  });

  it('sits above the desktop footer bar while it is shown', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({}), { barVisible: true, usesMobileBar: false }),
    ).toBe(60);
  });

  it('rides above an expanded action panel with an 8px gap', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({}), {
        barVisible: true,
        usesMobileBar: true,
        panelTopOffset: 200,
      }),
    ).toBe(208);
  });

  it('never drops below the bar offset for a tiny panel measurement', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({}), {
        barVisible: true,
        usesMobileBar: true,
        panelTopOffset: 20,
      }),
    ).toBe(72);
  });

  it('ignores the panel offset once the bar is dismissed', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({}), { barVisible: false, panelTopOffset: 200 }),
    ).toBe(DEFAULT_BOOK_LAYOUT.marginBottomPx);
  });

  it('sits above the footer band once the bar is dismissed (default settings)', () => {
    expect(getTTSMiniPlayerBottomOffset(settings({}), { barVisible: false })).toBe(
      DEFAULT_BOOK_LAYOUT.marginBottomPx,
    );
  });

  it('sits above the floating footer pills in scrolled mode', () => {
    expect(getTTSMiniPlayerBottomOffset(settings({ scrolled: true }), { barVisible: false })).toBe(
      DEFAULT_BOOK_LAYOUT.marginBottomPx,
    );
  });

  it('falls back to 16px when Show Footer is off', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({ showFooter: false }), { barVisible: false }),
    ).toBe(16);
  });

  it('falls back to 16px when no footer widget renders at the bottom', () => {
    expect(
      getTTSMiniPlayerBottomOffset(
        settings({
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
        { barVisible: false },
      ),
    ).toBe(16);
  });

  it('keeps the footer offset for the sticky progress bar even without widgets', () => {
    expect(
      getTTSMiniPlayerBottomOffset(
        settings({
          showStickyProgressBar: true,
          showRemainingTime: false,
          showRemainingPages: false,
          showProgressInfo: false,
          showCurrentTime: false,
          showCurrentBatteryStatus: false,
        }),
        { barVisible: false },
      ),
    ).toBe(DEFAULT_BOOK_LAYOUT.marginBottomPx);
  });

  it('falls back to 16px in vertical writing mode (footer is a side column)', () => {
    expect(getTTSMiniPlayerBottomOffset(settings({ vertical: true }), { barVisible: false })).toBe(
      16,
    );
  });

  it('never drops below 16px even with a tiny bottom margin', () => {
    expect(
      getTTSMiniPlayerBottomOffset(settings({ marginBottomPx: 8 }), { barVisible: false }),
    ).toBe(16);
  });
});
