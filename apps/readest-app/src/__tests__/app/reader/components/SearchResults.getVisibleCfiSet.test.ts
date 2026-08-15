import { describe, expect, it } from 'vitest';

import { getVisibleCfiSet } from '@/app/reader/components/sidebar/SearchResults';
import { FoliateView } from '@/types/view';

// A paginated multi-column page straddling a chapter boundary renders the tail
// of the previous section and the head of the next one in the same viewport,
// but foliate's relocate range covers only the primary section's document. The
// list highlight therefore misses results in the adjacent visible section —
// getVisibleCfiSet closes that gap by checking each non-primary result's actual
// on-screen rect (frame offset + content rect) against the view container.
//
// Rects are expressed in the same coordinate space as ReadingRuler's
// mapRangeRectsToOverlay: a result's screen rect = frame.left + content rect.

type Rect = { left: number; right: number; top: number; bottom: number };
const rect = (left: number, right: number, top = 0, bottom = 10): Rect => ({
  left,
  right,
  top,
  bottom,
});

const frameEl = (left: number, right: number) => ({
  getBoundingClientRect: () => rect(left, right, 0, 100),
});

const rangeLike = (left: number, right: number) => ({
  getBoundingClientRect: () => rect(left, right),
});

const viewport = rect(0, 800, 0, 600) as unknown as DOMRect;

type Content = { index?: number; doc: unknown };
const makeView = (
  contents: Content[],
  primaryIndex: number,
  resolveCFI: (cfi: string) => { index: number; anchor: (doc: unknown) => unknown },
): FoliateView =>
  ({
    renderer: { getContents: () => contents, primaryIndex },
    resolveCFI,
  }) as unknown as FoliateView;

describe('getVisibleCfiSet', () => {
  it('returns nothing when only the primary section is loaded', () => {
    const view = makeView(
      [{ index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } }],
      0,
      () => ({ index: 0, anchor: () => rangeLike(0, 10) }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/0!/4/1)'], viewport)).toEqual(new Set());
  });

  it('ignores results in the primary section even when they are on screen', () => {
    const view = makeView(
      [
        { index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } },
        { index: 1, doc: { defaultView: { frameElement: frameEl(700, 900) } } },
      ],
      0,
      () => ({ index: 0, anchor: () => rangeLike(0, 10) }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/0!/4/1)'], viewport)).toEqual(new Set());
  });

  it('skips sections whose frame is entirely off-screen', () => {
    const view = makeView(
      [
        { index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } },
        { index: 1, doc: { defaultView: { frameElement: frameEl(2000, 2200) } } },
      ],
      0,
      () => ({ index: 1, anchor: () => rangeLike(0, 10) }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/1!/4/1)'], viewport)).toEqual(new Set());
  });

  it('highlights a result in the adjacent section whose rect is on screen', () => {
    const view = makeView(
      [
        { index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } },
        { index: 1, doc: { defaultView: { frameElement: frameEl(700, 900) } } },
      ],
      0,
      () => ({ index: 1, anchor: () => rangeLike(50, 100) }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/1!/4/2)'], viewport)).toEqual(
      new Set(['epubcfi(/6/1!/4/2)']),
    );
  });

  it('excludes a result in an on-screen adjacent section whose rect is off-screen', () => {
    const view = makeView(
      [
        { index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } },
        { index: 1, doc: { defaultView: { frameElement: frameEl(700, 900) } } },
      ],
      0,
      () => ({ index: 1, anchor: () => rangeLike(900, 950) }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/1!/4/2)'], viewport)).toEqual(new Set());
  });

  it('handles anchors that resolve to a numeric offset (no DOM rect)', () => {
    const view = makeView(
      [
        { index: 0, doc: { defaultView: { frameElement: frameEl(0, 800) } } },
        { index: 1, doc: { defaultView: { frameElement: frameEl(700, 900) } } },
      ],
      0,
      () => ({ index: 1, anchor: () => 0 }),
    );
    expect(getVisibleCfiSet(view, ['epubcfi(/6/1!/4/2)'], viewport)).toEqual(new Set());
  });
});
