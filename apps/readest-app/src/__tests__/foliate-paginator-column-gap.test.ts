// The `column-gap` override of foliate-js's paginator: the centre gap of a
// two-column spread becomes the given width, the host grid hands the
// difference back so the text keeps its outer edge, and the column-width hint
// shrinks with the gap so the browser still fits two columns.
import { describe, expect, it } from 'vitest';

import { getColumnGapHostTracks, getHorizontalColumnMetrics } from 'foliate-js/paginator.js';

// CSS Multi-column Layout §3.4 pseudo-algorithm for `column-width` with
// `column-count: auto`: the browser fits as many columns of at least the hint
// as the content box allows.
const cssColumnCount = (contentWidth: number, hint: number, gap: number) =>
  Math.max(1, Math.floor((contentWidth + gap) / (hint + gap)));

// A 900px container, 16px side margins, a 5% gap already converted to px the
// way #beforeRender does it (g / (1 - g) * size).
const width = 900;
const marginLeft = 16;
const marginRight = 16;
const gap = (0.05 / 0.95) * width;
// #beforeRender's hint for a spread: size / 2 - gap - marginRight / 2 - marginLeft / 2
const columnWidth = width / 2 - gap - marginRight / 2 - marginLeft / 2;
const spread = { width, marginLeft, marginRight, gap, columnWidth, columnCount: 2 };

// A page of the multi-column flow tiles only when its side paddings add up to
// the column gap (the flow repeats column, gap, column, gap, ...).
const tiles = (m: ReturnType<typeof getHorizontalColumnMetrics>) =>
  expect(m.sidePaddingLeft + m.sidePaddingRight).toBeCloseTo(m.columnGap);

describe('getHorizontalColumnMetrics', () => {
  it('derives the centre gap from the margins and gap percentage by default', () => {
    const m = getHorizontalColumnMetrics({ ...spread, columnGap: null });
    expect(m.sidePaddingLeft).toBeCloseTo(marginLeft / 4 + gap / 4);
    expect(m.sidePaddingRight).toBeCloseTo(marginRight / 4 + gap / 4);
    expect(m.columnGap).toBeCloseTo((marginLeft + marginRight) / 4 + gap / 2);
    tiles(m);
    expect(m.columnWidth).toBe(Math.trunc(columnWidth));
    expect(m.availableWidth).toBe(Math.trunc(width / 2 - m.sidePaddingLeft - m.sidePaddingRight));
  });

  it('sets the centre gap and splits it over the sides when column-gap is set', () => {
    const m = getHorizontalColumnMetrics({ ...spread, columnGap: 120 });
    expect(m.columnGap).toBe(120);
    expect(m.sidePaddingLeft).toBe(60);
    expect(m.sidePaddingRight).toBe(60);
    tiles(m);
    expect(m.columnWidth).toBe(Math.trunc(width / 2 - 120));
    expect(m.availableWidth).toBe(m.columnWidth);
  });

  it('keeps two columns under a wide gap, where the derived hint would collapse to one', () => {
    for (const columnGap of [0, 40, 120, 200]) {
      const m = getHorizontalColumnMetrics({ ...spread, columnGap });
      const contentWidth = width - m.sidePaddingLeft - m.sidePaddingRight;
      expect(cssColumnCount(contentWidth, m.columnWidth, m.columnGap)).toBe(2);
    }
    // The landmine the shrink exists for: the old hint plus a wide gap is one column.
    const base = getHorizontalColumnMetrics({ ...spread, columnGap: null });
    expect(cssColumnCount(width - 200, base.columnWidth, 200)).toBe(1);
  });

  it('ignores the override for a single column and for an unusable value', () => {
    const single = { ...spread, columnCount: 1, columnWidth: width - gap - 16 };
    const one = getHorizontalColumnMetrics({ ...single, columnGap: null });
    expect(getHorizontalColumnMetrics({ ...single, columnGap: 120 })).toEqual(one);
    const two = getHorizontalColumnMetrics({ ...spread, columnGap: null });
    expect(getHorizontalColumnMetrics({ ...spread, columnGap: NaN })).toEqual(two);
    expect(getHorizontalColumnMetrics({ ...spread, columnGap: -8 })).toEqual(two);
  });
});

describe('getColumnGapHostTracks', () => {
  // 5% of a 951px host, the value the grid's own tracks resolve `--_gap` to.
  const hostGap = 0.05 * 951;
  const derived = marginLeft / 4 + hostGap / 4; // one side: outer minimum = side padding
  const base = { marginLeft, marginRight, hostGap };
  // Where the text starts on an uncapped page: outer track at its minimum,
  // then the page's own side padding of half the gap.
  const outerEdge = (columnGap: number) =>
    getColumnGapHostTracks({ ...base, columnGap }).outerMinLeft + columnGap / 2;

  it('is the identity at the derived gap', () => {
    const t = getColumnGapHostTracks({ ...base, columnGap: 2 * derived });
    expect(t.outerMinLeft).toBeCloseTo(derived);
    expect(t.outerMinRight).toBeCloseTo(derived);
    expect(t.capExtra).toBeCloseTo(0);
  });

  it('keeps the outer edge up to twice the derived gap and widens the cap by the extra', () => {
    for (const columnGap of [8, 40, 56, 4 * derived]) {
      expect(outerEdge(columnGap), `gap ${columnGap}`).toBeCloseTo(2 * derived);
      const t = getColumnGapHostTracks({ ...base, columnGap });
      expect(t.capExtra).toBeCloseTo(columnGap - 2 * derived);
    }
  });

  it('moves the edge inward by half the gap once the outer track is used up', () => {
    const t = getColumnGapHostTracks({ ...base, columnGap: 120 });
    expect(t.outerMinLeft).toBe(0);
    expect(t.outerMinRight).toBe(0);
    expect(outerEdge(120)).toBe(60);
    expect(t.capExtra).toBeCloseTo(120 - 2 * derived);
  });
});
