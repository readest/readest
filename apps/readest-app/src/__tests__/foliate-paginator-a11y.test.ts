// Regression test for readest/readest issues #4243 and #4259.
//
// In dual-page mode, when adjacent columns belong to *different* sections,
// the section in the right column lives in a non-primary view. Such visible
// non-primary views must not be marked `aria-hidden` (and must not be made
// `inert`), otherwise screen readers skip them and link clicks plus text
// selection break in the right column.
import { describe, expect, it } from 'vitest';

import { isViewVisibleInContainer } from 'foliate-js/paginator.js';

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

describe('isViewVisibleInContainer', () => {
  const container = rect(0, 0, 1240, 600);

  it('returns true when the view fills the container', () => {
    expect(isViewVisibleInContainer(rect(0, 0, 1240, 600), container)).toBe(true);
  });

  it('returns true for a long view spilling beyond the container (right column case)', () => {
    // Mirrors the real-world case from issue #4243: the section starts at the
    // right column edge (column ~= half container width) and extends far past
    // the visible area on the right.
    expect(isViewVisibleInContainer(rect(640, 0, 28000, 600), container)).toBe(true);
  });

  it('returns true for a view straddling the left edge', () => {
    expect(isViewVisibleInContainer(rect(-100, 0, 200, 600), container)).toBe(true);
  });

  it('returns false for a view entirely off-screen to the left', () => {
    expect(isViewVisibleInContainer(rect(-2000, 0, 600, 600), container)).toBe(false);
  });

  it('returns false for a view entirely off-screen to the right', () => {
    expect(isViewVisibleInContainer(rect(1500, 0, 600, 600), container)).toBe(false);
  });

  it('returns false when the view touches the right edge but does not overlap', () => {
    expect(isViewVisibleInContainer(rect(1240, 0, 600, 600), container)).toBe(false);
  });

  it('returns false when the view touches the left edge from the left but does not overlap', () => {
    expect(isViewVisibleInContainer(rect(-600, 0, 600, 600), container)).toBe(false);
  });

  it('returns false when the view is fully above the container (scrolled-mode case)', () => {
    expect(isViewVisibleInContainer(rect(0, -1000, 1240, 400), container)).toBe(false);
  });

  it('returns false when the view is fully below the container', () => {
    expect(isViewVisibleInContainer(rect(0, 600, 1240, 400), container)).toBe(false);
  });
});
