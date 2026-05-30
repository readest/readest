import { describe, expect, it } from 'vitest';
import { getPanelTopInset } from '@/utils/insets';

const insets = (top: number) => ({ top, right: 0, bottom: 0, left: 0 });

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
