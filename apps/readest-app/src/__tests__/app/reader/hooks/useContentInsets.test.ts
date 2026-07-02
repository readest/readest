import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentInsets } from '@/app/reader/hooks/useContentInsets';
import { ViewSettings } from '@/types/book';

const ZERO: { top: number; right: number; bottom: number; left: number } = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    showHeader: true,
    showFooter: true,
    vertical: false,
    writingMode: 'horizontal-tb',
    marginTopPx: 44,
    marginBottomPx: 44,
    marginLeftPx: 16,
    marginRightPx: 16,
    compactMarginTopPx: 16,
    compactMarginBottomPx: 16,
    compactMarginLeftPx: 16,
    compactMarginRightPx: 16,
    ...overrides,
  }) as ViewSettings;

describe('useContentInsets', () => {
  // Regression for #4898: saveViewSettings mutates the ViewSettings object in
  // place (same reference), so left/right margin edits never reached the
  // paginator because the derived insets were memoized on the object identity.
  it('reflects an in-place left/right margin edit on the same viewSettings object', () => {
    const viewSettings = makeViewSettings();
    const { result, rerender } = renderHook(({ vs, gi }) => useContentInsets(vs, gi), {
      initialProps: { vs: viewSettings, gi: ZERO },
    });

    expect(result.current.contentInsets.left).toBe(16);
    expect(result.current.contentInsets.right).toBe(16);

    viewSettings.compactMarginLeftPx = 40;
    viewSettings.compactMarginRightPx = 32;
    rerender({ vs: viewSettings, gi: ZERO });

    expect(result.current.contentInsets.left).toBe(40);
    expect(result.current.contentInsets.right).toBe(32);
  });

  it('reflects an in-place top/bottom margin edit when header/footer are shown', () => {
    const viewSettings = makeViewSettings();
    const { result, rerender } = renderHook(({ vs, gi }) => useContentInsets(vs, gi), {
      initialProps: { vs: viewSettings, gi: ZERO },
    });

    expect(result.current.contentInsets.top).toBe(44);
    expect(result.current.contentInsets.bottom).toBe(44);

    viewSettings.marginTopPx = 60;
    viewSettings.marginBottomPx = 52;
    rerender({ vs: viewSettings, gi: ZERO });

    expect(result.current.contentInsets.top).toBe(60);
    expect(result.current.contentInsets.bottom).toBe(52);
  });

  it('adds the grid insets to the page margins', () => {
    const viewSettings = makeViewSettings();
    const { result } = renderHook(() =>
      useContentInsets(viewSettings, { top: 10, right: 4, bottom: 8, left: 6 }),
    );

    expect(result.current.contentInsets.top).toBe(54);
    expect(result.current.contentInsets.left).toBe(22);
  });

  it('keeps a stable contentInsets reference across a page turn (unchanged margins)', () => {
    const viewSettings = makeViewSettings();
    const { result, rerender } = renderHook(({ vs, gi }) => useContentInsets(vs, gi), {
      initialProps: { vs: viewSettings, gi: ZERO },
    });

    const first = result.current.contentInsets;
    // A page turn re-renders the cell without touching any margin setting.
    rerender({ vs: viewSettings, gi: ZERO });

    expect(result.current.contentInsets).toBe(first);
  });
});
