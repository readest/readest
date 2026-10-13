import { describe, expect, it } from 'vitest';
import type { Insets } from '@/types/misc';
import {
  getHorizontalInsetStyle,
  getPageAreaInsets,
  getPanelHorizontalInsetStyle,
  getPopupBounds,
  offsetPosition,
} from '@/utils/insets';
import { getPopupPosition, getPosition } from '@/utils/sel';
import type { Rect } from '@/utils/sel';

// Devices whose behaviour must not change (#6307): everything but iPhone Duo.
const iPhonePortrait: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
const iPhoneLandscape: Insets = { top: 0, right: 62, bottom: 21, left: 62 };
const iPad: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const androidCutout: Insets = { top: 24, right: 0, bottom: 0, left: 48 };
const duoCover: Insets = { top: 0, right: 76, bottom: 0, left: 0 };
const duoInner: Insets = { top: 0, right: 84, bottom: 34, left: 0 };

describe('getHorizontalInsetStyle', () => {
  it.each([
    ['iPhone portrait', iPhonePortrait],
    ['iPhone landscape', iPhoneLandscape],
    ['iPad', iPad],
    ['Android one-sided cutout', androidCutout],
  ])('is empty off the Duo for %s, so the element keeps its own padding', (_name, insets) => {
    expect(getHorizontalInsetStyle(insets, false)).toEqual({});
    expect(getHorizontalInsetStyle(insets, false, 16)).toEqual({});
  });

  it('is empty on desktop/web (no insets at all)', () => {
    expect(getHorizontalInsetStyle(null, false)).toEqual({});
    expect(getHorizontalInsetStyle(undefined, false, 16)).toEqual({});
  });

  it('on the Duo returns no style without a side inset, so responsive padding classes apply', () => {
    expect(getHorizontalInsetStyle(null, true)).toEqual({});
    expect(getHorizontalInsetStyle(undefined, true, 16)).toEqual({});
    expect(getHorizontalInsetStyle(iPhonePortrait, true, 16)).toEqual({});
  });

  it('on the Duo adds the base padding to each physical side independently', () => {
    expect(getHorizontalInsetStyle(duoCover, true, 16)).toEqual({
      paddingLeft: '16px',
      paddingRight: '92px',
    });
    expect(getHorizontalInsetStyle({ top: 0, right: 0, bottom: 0, left: 44 }, true)).toEqual({
      paddingLeft: '44px',
      paddingRight: '0px',
    });
  });
});

describe('getPanelHorizontalInsetStyle', () => {
  it.each([
    ['iPhone landscape', iPhoneLandscape],
    ['Android one-sided cutout', androidCutout],
    ['iPad', iPad],
  ])('is empty off the Duo for %s', (_name, insets) => {
    for (const isMobile of [true, false]) {
      expect(getPanelHorizontalInsetStyle(insets, false, isMobile, 'left')).toEqual({});
      expect(getPanelHorizontalInsetStyle(insets, false, isMobile, 'right')).toEqual({});
    }
  });

  it('on the Duo pads both sides of a full-width mobile sheet', () => {
    expect(getPanelHorizontalInsetStyle(iPhoneLandscape, true, true, 'left')).toEqual({
      paddingLeft: '62px',
      paddingRight: '62px',
    });
  });

  it('on the Duo pads only the screen edge of a side panel', () => {
    expect(getPanelHorizontalInsetStyle(iPhoneLandscape, true, false, 'left')).toEqual({
      paddingLeft: '62px',
      paddingRight: '0px',
    });
    expect(getPanelHorizontalInsetStyle(iPhoneLandscape, true, false, 'right')).toEqual({
      paddingLeft: '0px',
      paddingRight: '62px',
    });
  });

  it('on the Duo returns no style when the screen edge has no inset', () => {
    expect(getPanelHorizontalInsetStyle(duoCover, true, false, 'left')).toEqual({});
    expect(getPanelHorizontalInsetStyle(null, true, false, 'left')).toEqual({});
  });
});

describe('getPageAreaInsets', () => {
  it('keeps a single column asymmetric so it can use the freed width', () => {
    expect(getPageAreaInsets(duoInner, false)).toBe(duoInner);
  });

  it('centres a spread by insetting both sides by the larger inset', () => {
    expect(getPageAreaInsets(duoInner, true)).toEqual({ top: 0, right: 84, bottom: 34, left: 84 });
    expect(getPageAreaInsets({ ...duoInner, right: 0, left: 84 }, true)).toEqual({
      top: 0,
      right: 84,
      bottom: 34,
      left: 84,
    });
  });

  it('returns the same object when already symmetric', () => {
    expect(getPageAreaInsets(iPhonePortrait, true)).toBe(iPhonePortrait);
  });
});

describe('getPopupBounds', () => {
  const cell: Rect = { left: 0, top: 0, right: 393, bottom: 852 };

  it.each([
    ['iPhone portrait', iPhonePortrait],
    ['iPhone landscape', iPhoneLandscape],
    ['iPad', iPad],
    ['Android one-sided cutout', androidCutout],
  ])('off the Duo is the raw cell rect with no origin shift for %s', (_name, insets) => {
    const { rect, origin } = getPopupBounds(cell, insets, false);
    expect(rect).toBe(cell);
    expect(origin).toEqual({ x: 0, y: 0 });
  });

  it('on the Duo shrinks the cell by the insets and shifts back by (left, top)', () => {
    const insets: Insets = { top: 59, right: 0, bottom: 34, left: 84 };
    const { rect, origin } = getPopupBounds(cell, insets, true);
    expect(rect).toEqual({ left: 84, top: 59, right: 393, bottom: 818 });
    expect(origin).toEqual({ x: 84, y: 59 });
  });

  it('never inverts when the insets exceed the cell', () => {
    const { rect } = getPopupBounds(
      { left: 0, top: 0, right: 100, bottom: 100 },
      { top: 0, right: 1000, bottom: 0, left: 0 },
      true,
    );
    expect(rect.right).toBeGreaterThanOrEqual(rect.left);
  });
});

describe('offsetPosition', () => {
  it('translates the point and keeps the direction', () => {
    expect(offsetPosition({ point: { x: 10, y: 20 }, dir: 'down' }, { x: 84, y: 59 })).toEqual({
      point: { x: 94, y: 79 },
      dir: 'down',
    });
  });
});

// Popups render relative to the cell's origin, while getPosition/getPopupPosition
// return points relative to the rect they are given. An inset rect therefore
// needs its result shifted back, or every popup lands `insets` away from the
// selection (a 59px top inset on an ordinary phone moved it up over the word).
describe('popup coordinates stay relative to the cell origin', () => {
  const cell: Rect = { left: 0, top: 0, right: 393, bottom: 852 };
  const padding = 10;
  const target = (): Element => {
    const el = document.createElement('span');
    el.getClientRects = () =>
      [{ left: 180, right: 240, top: 100, bottom: 120 }] as unknown as DOMRectList;
    return el;
  };
  const compute = (insets: Insets, isIPhoneDuo: boolean) => {
    const { rect, origin } = getPopupBounds(cell, insets, isIPhoneDuo);
    const triangle = getPosition(target(), rect, padding);
    const popup = getPopupPosition(triangle, rect, 200, 44, padding);
    return {
      triangle: offsetPosition(triangle, origin),
      popup: offsetPosition(popup, origin),
    };
  };

  it('with Duo insets and a target well inside the safe area, equals the no-inset result', () => {
    const none = compute({ top: 0, right: 0, bottom: 0, left: 0 }, true);
    const duo = compute({ top: 59, right: 0, bottom: 0, left: 84 }, true);
    expect(duo).toEqual(none);
  });

  it('off the Duo, equals the raw-cell computation even with a 59px top inset', () => {
    const raw = getPosition(target(), cell, padding);
    const off = compute(iPhonePortrait, false);
    expect(off.triangle).toEqual(raw);
    expect(off.popup).toEqual(getPopupPosition(raw, cell, 200, 44, padding));
  });

  it('on the Duo, clamps a popup away from the status strip', () => {
    // Target near the left edge: the popup must clear the 84px strip.
    const nearEdge = document.createElement('span');
    nearEdge.getClientRects = () =>
      [{ left: 5, right: 25, top: 400, bottom: 420 }] as unknown as DOMRectList;
    const { rect, origin } = getPopupBounds(cell, { top: 0, right: 0, bottom: 0, left: 84 }, true);
    const popup = offsetPosition(
      getPopupPosition(getPosition(nearEdge, rect, padding), rect, 200, 44, padding),
      origin,
    );
    expect(popup.point.x).toBeGreaterThanOrEqual(84);
  });
});
