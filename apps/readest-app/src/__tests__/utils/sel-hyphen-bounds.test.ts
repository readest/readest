import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isRangeStartAtBlockStart,
  hasTrailingHyphenRectPattern,
  isHyphenHandleBugProneRange,
  rangeFromAnchorToPoint,
  repairJumpedSelectionRange,
} from '@/utils/sel';

// Issue #1553: Android WebView (Blink) records a bogus selection start bound on
// auto-hyphen fragments whenever a touch selection starts at the first character
// of a paragraph. These utilities detect that condition and repair the corrupted
// anchor so the app can suppress the broken native handles.

const makeParagraph = (html: string) => {
  document.body.innerHTML = html;
  return document.body.querySelector('p')!;
};

const originalGetClientRects = Range.prototype.getClientRects;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Range.prototype.getClientRects = originalGetClientRects;
});

describe('isRangeStartAtBlockStart', () => {
  it('returns true for a range starting at offset 0 of the first text node', () => {
    const p = makeParagraph('<p>Argentina has suffered</p>');
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 9);
    expect(isRangeStartAtBlockStart(range)).toBe(true);
  });

  it('returns true when only collapsed whitespace precedes the start', () => {
    const p = makeParagraph('<p>\n  Argentina has suffered</p>');
    const range = document.createRange();
    range.setStart(p.firstChild!, 3);
    range.setEnd(p.firstChild!, 12);
    expect(isRangeStartAtBlockStart(range)).toBe(true);
  });

  it('returns true when the start is inside a leading inline element', () => {
    const p = makeParagraph('<p><em>Argentina</em> has suffered</p>');
    const em = p.querySelector('em')!;
    const range = document.createRange();
    range.setStart(em.firstChild!, 0);
    range.setEnd(p.lastChild!, 4);
    expect(isRangeStartAtBlockStart(range)).toBe(true);
  });

  it('returns false for a mid-paragraph selection', () => {
    const p = makeParagraph('<p>Argentina has suffered</p>');
    const range = document.createRange();
    range.setStart(p.firstChild!, 10);
    range.setEnd(p.firstChild!, 13);
    expect(isRangeStartAtBlockStart(range)).toBe(false);
  });

  it('returns false when non-whitespace text precedes in an earlier node', () => {
    const p = makeParagraph('<p><em>Since</em> the 1970s</p>');
    const textAfterEm = p.lastChild!;
    const range = document.createRange();
    range.setStart(textAfterEm, 1);
    range.setEnd(textAfterEm, 4);
    expect(isRangeStartAtBlockStart(range)).toBe(false);
  });
});

describe('hasTrailingHyphenRectPattern', () => {
  const em = 17.5;
  const line = (x: number, y: number, w: number, h = 24) => ({
    left: x,
    top: y,
    width: w,
    height: h,
  });

  it('detects a narrow rect appended to the end of a line (auto-hyphen)', () => {
    // Mirrors the measured layout of issue #1553: justified lines of ~316px
    // with a 9.2px generated hyphen box at the line end.
    const rects = [line(737.5, 154, 315.9), line(1053.4, 154, 9.2), line(737.5, 182, 325.1)];
    expect(hasTrailingHyphenRectPattern(rects, em, false)).toBe(true);
  });

  it('returns false when each line is a single rect', () => {
    const rects = [line(737.5, 154, 315.9), line(737.5, 182, 325.1), line(737.5, 210, 216.9)];
    expect(hasTrailingHyphenRectPattern(rects, em, false)).toBe(false);
  });

  it('returns false when the narrow rect is on a different line', () => {
    const rects = [line(737.5, 154, 315.9), line(737.5, 182, 9.2)];
    expect(hasTrailingHyphenRectPattern(rects, em, false)).toBe(false);
  });

  it('returns false when the same-line rect is too wide to be a hyphen', () => {
    // BiDi runs split a line into multiple wide rects.
    const rects = [line(737.5, 154, 200), line(937.5, 154, 100)];
    expect(hasTrailingHyphenRectPattern(rects, em, false)).toBe(false);
  });

  it('returns false when the narrow rect is not adjacent to the line end', () => {
    const rects = [line(737.5, 154, 200), line(1053.4, 154, 9.2)];
    expect(hasTrailingHyphenRectPattern(rects, em, false)).toBe(false);
  });

  it('detects the pattern in vertical writing mode (axes swapped)', () => {
    const rects = [
      { left: 154, top: 737.5, width: 24, height: 315.9 },
      { left: 154, top: 1053.4, width: 24, height: 9.2 },
    ];
    expect(hasTrailingHyphenRectPattern(rects, em, true)).toBe(true);
  });

  it('returns false for empty or single-rect input', () => {
    expect(hasTrailingHyphenRectPattern([], em, false)).toBe(false);
    expect(hasTrailingHyphenRectPattern([line(0, 0, 300)], em, false)).toBe(false);
  });
});

describe('repairJumpedSelectionRange', () => {
  const longText =
    'Argentina has suffered from repeated bouts of high inflation throughout its history. ' +
    'Every once in a while, the central bank replaces the existing currency with a new one ' +
    'with zeros removed, which makes it more readable. Think of replacing dollars with a ' +
    'new currency called bollars and declaring one bollar worth one billion of the old dollars.';

  const setup = () => {
    const p = makeParagraph(`<p>${longText}</p>`);
    const node = p.firstChild as Text;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    return { node, sel };
  };

  it('returns null when the gesture-initial anchor is still inside the range', () => {
    const { node, sel } = setup();
    sel.setBaseAndExtent(node, 0, node, 9);
    expect(repairJumpedSelectionRange(sel, node, 0)).toBeNull();
  });

  it('rebuilds [initial anchor → focus] when the anchor jumped forward (issue #1553)', () => {
    const { node, sel } = setup();
    // The corrupted state observed on device: the renderer re-anchored the
    // base at the last hyphen (offset 325) while the finger/focus is at 53.
    sel.setBaseAndExtent(node, 325, node, 53);
    const repaired = repairJumpedSelectionRange(sel, node, 0);
    expect(repaired).not.toBeNull();
    expect(repaired!.startContainer).toBe(node);
    expect(repaired!.startOffset).toBe(0);
    expect(repaired!.endContainer).toBe(node);
    // Snapped forward to the containing word boundary ("inflation").
    expect(repaired!.endOffset).toBeGreaterThanOrEqual(53);
    expect(repaired!.toString().startsWith('Argentina')).toBe(true);
  });

  it('orders the range correctly when the focus precedes the initial anchor', () => {
    const { node, sel } = setup();
    // Anchor jumped forward past the initial anchor; the focus stayed before it.
    sel.setBaseAndExtent(node, 325, node, 250);
    const repaired = repairJumpedSelectionRange(sel, node, 340);
    expect(repaired).not.toBeNull();
    expect(repaired!.startOffset).toBeLessThan(repaired!.endOffset);
    expect(repaired!.startOffset).toBeLessThanOrEqual(250);
    expect(repaired!.endOffset).toBeGreaterThanOrEqual(340);
  });

  it('returns null for a collapsed result or empty selection', () => {
    const { node, sel } = setup();
    expect(repairJumpedSelectionRange(sel, node, 0)).toBeNull();
    sel.setBaseAndExtent(node, 325, node, 53);
    // focus == initial anchor would collapse; jsdom snaps may expand, so just
    // assert it does not throw and returns a range or null.
    const result = repairJumpedSelectionRange(sel, node, 53);
    if (result) expect(result.collapsed).toBe(false);
  });
});

describe('rangeFromAnchorToPoint', () => {
  const text = 'Since the mid-1990s, a group of economists have been saying just that.';

  const setupCaretStub = (node: Text, offset: number) => {
    const stub = () => ({ offsetNode: node, offset });
    (document as unknown as Record<string, unknown>)['caretPositionFromPoint'] = stub;
  };

  afterEach(() => {
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
  });

  it('builds a forward range from the anchor to the caret at the point', () => {
    const p = makeParagraph(`<p>${text}</p>`);
    const node = p.firstChild as Text;
    setupCaretStub(node, 43);
    const range = rangeFromAnchorToPoint(document, node, 0, 100, 50);
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(0);
    // Snapped to the word boundary containing offset 43 ("economists").
    expect(range!.endOffset).toBeGreaterThanOrEqual(42);
    expect(range!.toString().startsWith('Since')).toBe(true);
  });

  it('orders the range when the point precedes the anchor', () => {
    const p = makeParagraph(`<p>${text}</p>`);
    const node = p.firstChild as Text;
    setupCaretStub(node, 10);
    const range = rangeFromAnchorToPoint(document, node, 32, 5, 5);
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBeLessThan(range!.endOffset);
    expect(range!.endOffset).toBe(32);
  });

  it('returns null when the point resolves nowhere or collapses', () => {
    const p = makeParagraph(`<p>${text}</p>`);
    const node = p.firstChild as Text;
    // jsdom has no caretPositionFromPoint/caretRangeFromPoint by default.
    expect(rangeFromAnchorToPoint(document, node, 0, 10, 10)).toBeNull();
    setupCaretStub(node, 0);
    expect(rangeFromAnchorToPoint(document, node, 0, 10, 10)).toBeNull();
  });
});

describe('isHyphenHandleBugProneRange', () => {
  const stubLayout = (p: HTMLElement, rects: DOMRect[], hyphens = 'auto') => {
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = origGetComputedStyle(el);
      if (el === p) {
        const proxy = Object.create(style);
        proxy.getPropertyValue = (prop: string) =>
          prop === 'hyphens' || prop === '-webkit-hyphens' ? hyphens : style.getPropertyValue(prop);
        proxy.fontSize = '17.5px';
        return proxy;
      }
      return style;
    });
    // jsdom does not implement Range.getClientRects at all; install one.
    Range.prototype.getClientRects = function (this: Range) {
      const list = this.startContainer.parentElement === p ? rects : [];
      return Object.assign(list.slice(), {
        item: (i: number) => list[i] ?? null,
      }) as unknown as DOMRectList;
    };
  };

  const hyphenRects = [
    new DOMRect(737.5, 154, 315.9, 24),
    new DOMRect(1053.4, 154, 9.2, 24),
    new DOMRect(737.5, 182, 325.1, 24),
  ];

  it('detects a first-word selection in a hyphenated paragraph', () => {
    const p = makeParagraph('<p>Argentina has suffered from repeated bouts</p>');
    stubLayout(p, hyphenRects);
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 9);
    expect(isHyphenHandleBugProneRange(range)).toBe(true);
  });

  it('returns false for a mid-paragraph selection in the same paragraph', () => {
    const p = makeParagraph('<p>Argentina has suffered from repeated bouts</p>');
    stubLayout(p, hyphenRects);
    const range = document.createRange();
    range.setStart(p.firstChild!, 10);
    range.setEnd(p.firstChild!, 13);
    expect(isHyphenHandleBugProneRange(range)).toBe(false);
  });

  it('returns false when hyphenation is not enabled and no soft hyphens exist', () => {
    const p = makeParagraph('<p>Argentina has suffered from repeated bouts</p>');
    stubLayout(p, hyphenRects, 'manual');
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 9);
    expect(isHyphenHandleBugProneRange(range)).toBe(false);
  });

  it('still applies with hyphens:manual when the text carries soft hyphens', () => {
    const p = makeParagraph('<p>Argentina has suf­fered from repeated bouts</p>');
    stubLayout(p, hyphenRects, 'manual');
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 9);
    expect(isHyphenHandleBugProneRange(range)).toBe(true);
  });

  it('returns false when the paragraph has no generated hyphen boxes', () => {
    const p = makeParagraph('<p>The traditional explanation for this</p>');
    stubLayout(p, [new DOMRect(737.5, 530, 325.1, 24), new DOMRect(737.5, 558, 325.1, 24)]);
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 3);
    expect(isHyphenHandleBugProneRange(range)).toBe(false);
  });
});
