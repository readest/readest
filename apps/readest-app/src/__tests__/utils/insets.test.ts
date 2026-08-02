import { describe, expect, it } from 'vitest';
import { getHeaderBandGeometry, getPanelTopInset } from '@/utils/insets';

const insets = (top: number) => ({ top, right: 0, bottom: 0, left: 0 });

describe('getHeaderBandGeometry (#5303)', () => {
  it('keeps the classic band below the safe area for margins of 16px and up', () => {
    // Default mobile layout: notch 39px, margin 44px.
    expect(getHeaderBandGeometry(39, 44)).toEqual({ top: 39, height: 44, bottom: 83 });
    expect(getHeaderBandGeometry(39, 16)).toEqual({ top: 39, height: 16, bottom: 55 });
    // Desktop: no notch, minimum margin is 16.
    expect(getHeaderBandGeometry(0, 16)).toEqual({ top: 0, height: 16, bottom: 16 });
  });

  it('keeps a readable 16px band by borrowing from the notch below 16px margins', () => {
    // The band bottom stays at the content top (topInset + margin) while the
    // top lifts into the notch so the title is never clipped.
    expect(getHeaderBandGeometry(39, 8)).toEqual({ top: 31, height: 16, bottom: 47 });
    expect(getHeaderBandGeometry(39, 0)).toEqual({ top: 23, height: 16, bottom: 39 });
  });

  it('lifts the band into the notch on negative margins', () => {
    expect(getHeaderBandGeometry(39, -20)).toEqual({ top: 3, height: 16, bottom: 19 });
  });

  it('pins the band to the screen top once the content top hits the 16px floor', () => {
    // The renderer floors the content top at 16px (moreTopInset), so the band
    // bottom must not go below 16 either — the two edges stay glued.
    expect(getHeaderBandGeometry(39, -23)).toEqual({ top: 0, height: 16, bottom: 16 });
    expect(getHeaderBandGeometry(39, -39)).toEqual({ top: 0, height: 16, bottom: 16 });
  });
});

describe('getPanelTopInset', () => {
  it('respects the status bar on non-mobile panels when system UI is visible', () => {
    // Regression for #4089: a tablet/desktop sidebar (isMobile === false) used to
    // collapse its top padding to 0, letting the status bar obscure the toolbar.
    expect(
      getPanelTopInset({
        isMobile: false,
        isFullHeightInMobile: false,
        systemUIVisible: true,
        statusBarHeight: 24,
        safeAreaInsets: insets(0),
      }),
    ).toBe(24);
  });

  it('uses the larger of the safe-area inset and the status bar height', () => {
    expect(
      getPanelTopInset({
        isMobile: false,
        isFullHeightInMobile: false,
        systemUIVisible: true,
        statusBarHeight: 24,
        safeAreaInsets: insets(40),
      }),
    ).toBe(40);
  });

  it('uses the safe-area inset alone on non-mobile panels when system UI is hidden', () => {
    expect(
      getPanelTopInset({
        isMobile: false,
        isFullHeightInMobile: false,
        systemUIVisible: false,
        statusBarHeight: 24,
        safeAreaInsets: insets(0),
      }),
    ).toBe(0);
  });

  it('pads a full-height mobile sheet with the status bar', () => {
    expect(
      getPanelTopInset({
        isMobile: true,
        isFullHeightInMobile: true,
        systemUIVisible: true,
        statusBarHeight: 24,
        safeAreaInsets: insets(0),
      }),
    ).toBe(24);
  });

  it('does not pad a partial-height mobile sheet that is not at the top', () => {
    expect(
      getPanelTopInset({
        isMobile: true,
        isFullHeightInMobile: false,
        systemUIVisible: true,
        statusBarHeight: 24,
        safeAreaInsets: insets(0),
      }),
    ).toBe(0);
  });

  it('treats missing safe-area insets as zero', () => {
    expect(
      getPanelTopInset({
        isMobile: false,
        isFullHeightInMobile: false,
        systemUIVisible: false,
        statusBarHeight: 24,
        safeAreaInsets: null,
      }),
    ).toBe(0);
  });
});
