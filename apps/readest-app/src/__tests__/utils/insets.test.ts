import { describe, expect, it } from 'vitest';
import { getPanelTopInset, getScrolledContentMargins } from '@/utils/insets';
import type { ViewSettings } from '@/types/book';

const insets = (top: number, bottom = 0) => ({ top, right: 0, bottom, left: 0 });

const scrolledSettings = (overrides: Partial<ViewSettings> = {}) =>
  ({
    showHeader: true,
    showFooter: true,
    vertical: false,
    marginTopPx: 44,
    marginBottomPx: 44,
    showTTSBar: true,
    ...overrides,
  }) as ViewSettings;

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

describe('getScrolledContentMargins', () => {
  it('reserves the full mobile footer height in scrolled mode', () => {
    expect(
      getScrolledContentMargins({
        gridInsets: insets(12, 30),
        viewSettings: scrolledSettings({ marginBottomPx: 44 }),
        ttsEnabled: false,
        hasSafeAreaInset: true,
        useMobileFooterLayout: true,
      }),
    ).toEqual({ top: 56, bottom: 64 + 30 * 0.33 });
  });

  it('reserves the desktop footer height when it exceeds the content margin', () => {
    expect(
      getScrolledContentMargins({
        gridInsets: insets(0),
        viewSettings: scrolledSettings({ marginBottomPx: 44 }),
        ttsEnabled: false,
        hasSafeAreaInset: false,
        useMobileFooterLayout: false,
      }).bottom,
    ).toBe(52);
  });

  it('keeps larger user footer margins and TTS clearance', () => {
    expect(
      getScrolledContentMargins({
        gridInsets: insets(0, 30),
        viewSettings: scrolledSettings({ marginBottomPx: 88 }),
        ttsEnabled: true,
        hasSafeAreaInset: true,
        useMobileFooterLayout: true,
      }).bottom,
    ).toBe(88 + 30 * 0.33);
  });

  it('does not reserve footer space for vertical writing footer chrome', () => {
    expect(
      getScrolledContentMargins({
        gridInsets: insets(12, 30),
        viewSettings: scrolledSettings({ vertical: true }),
        ttsEnabled: false,
        hasSafeAreaInset: true,
        useMobileFooterLayout: true,
      }),
    ).toEqual({ top: 0, bottom: 0 });
  });
});
