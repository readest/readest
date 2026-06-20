import { describe, expect, it } from 'vitest';
import { getFooterBarPosition } from '@/app/reader/components/footerbar/position';

describe('getFooterBarPosition', () => {
  it('pins the mobile footer layout to the viewport when no sidebar is pinned', () => {
    expect(getFooterBarPosition(true, false)).toBe('fixed');
  });

  it('anchors the footer inside the grid cell when the sidebar is pinned', () => {
    // Regression: a viewport-fixed footer slides under a pinned sidebar. When
    // the sidebar is pinned it occupies horizontal space, so the footer must
    // anchor within the book's grid cell and start at the sidebar's right edge.
    expect(getFooterBarPosition(true, true)).toBe('absolute');
  });

  it('keeps the desktop footer anchored in the grid cell regardless of pinning', () => {
    expect(getFooterBarPosition(false, false)).toBe('absolute');
    expect(getFooterBarPosition(false, true)).toBe('absolute');
  });
});
