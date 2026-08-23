import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyCrossDocSegments,
  buildCrossDocSegments,
  findContentAtPoint,
  getCaretPositionInText,
  getDocTextBounds,
  isTextAtPoint,
  rangeBetweenPositions,
  setNativeDragFrozen,
  toDocPoint,
} from '@/app/reader/utils/crossDocSelection';
import type { Rect } from '@/utils/sel';

// A section iframe the way fixed-layout renders a PDF page: the page text lives
// in `.textLayer` spans, with pdf.js's empty `.endOfContent` div last.
const makePage = (rect: Rect, spans: string[], index?: number) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    `<div id="canvas"><canvas></canvas></div><div class="textLayer">` +
    spans.map((s) => `<span>${s}</span>`).join('') +
    `<div class="endOfContent"></div></div><div class="annotationLayer"></div>`;
  iframe.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return { doc, index, iframe };
};

const textNode = (doc: Document, nth: number) =>
  doc.querySelectorAll('.textLayer span')[nth]!.firstChild as Text;

describe('crossDocSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('findContentAtPoint', () => {
    it('returns the section whose iframe contains the window point', () => {
      const a = makePage({ left: 100, top: 0, right: 500, bottom: 400 }, ['a'], 3);
      const b = makePage({ left: 100, top: 404, right: 500, bottom: 804 }, ['b'], 4);
      expect(findContentAtPoint([a, b], { x: 200, y: 500 })).toEqual({ doc: b.doc, index: 4 });
      expect(findContentAtPoint([a, b], { x: 200, y: 100 })).toEqual({ doc: a.doc, index: 3 });
    });

    it('skips blank placeholder frames and misses', () => {
      const a = makePage({ left: 100, top: 0, right: 500, bottom: 400 }, ['a'], 3);
      // The paginated renderer lists a blank iframe with no section index.
      const blank = makePage({ left: 0, top: 0, right: 1000, bottom: 1000 }, []);
      expect(findContentAtPoint([blank, a], { x: 200, y: 100 })).toEqual({ doc: a.doc, index: 3 });
      expect(findContentAtPoint([a], { x: 200, y: 402 })).toBeNull();
    });
  });

  describe('toDocPoint', () => {
    it('maps a window point into the iframe, undoing a CSS scale on the frame', () => {
      const a = makePage({ left: 100, top: 50, right: 300, bottom: 250 }, ['a'], 0);
      // 400x400 CSS px iframe drawn at 200x200 (scaled 0.5 by a pinch preview).
      Object.defineProperty(a.iframe, 'clientWidth', { value: 400 });
      Object.defineProperty(a.iframe, 'clientHeight', { value: 400 });
      expect(toDocPoint(a.doc, { x: 200, y: 150 })).toEqual({ x: 200, y: 200 });
    });
  });

  describe('isTextAtPoint', () => {
    it('is true on a glyph and false on the blank page area the caret snapped from', () => {
      const a = makePage({ left: 0, top: 0, right: 400, bottom: 400 }, ['alpha'], 0);
      const text = textNode(a.doc, 0);
      // The caret lookup snaps any point to the nearest glyph; the glyph's box
      // decides whether the point was actually on text.
      a.doc.caretPositionFromPoint = () => ({ offsetNode: text, offset: 2 }) as never;
      const win = a.iframe.contentWindow as Window & typeof globalThis;
      win.Range.prototype.getClientRects = () =>
        [{ left: 10, top: 10, right: 60, bottom: 30 }] as unknown as DOMRectList;
      expect(isTextAtPoint(a.doc, 20, 20)).toBe(true);
      expect(isTextAtPoint(a.doc, 20, 200)).toBe(false);
      // A caret on an element (no text under the point at all) is not text.
      a.doc.caretPositionFromPoint = () => ({ offsetNode: a.doc.body, offset: 0 }) as never;
      expect(isTextAtPoint(a.doc, 20, 20)).toBe(false);
    });
  });

  describe('getCaretPositionInText', () => {
    it('clamps a point above or below all glyphs to the text start/end, else asks the browser', () => {
      const a = makePage({ left: 0, top: 0, right: 400, bottom: 400 }, ['first', 'last'], 0);
      const win = a.iframe.contentWindow as Window & typeof globalThis;
      // Glyph boxes: "first" at y 10..20, "last" at y 100..110.
      win.Range.prototype.getBoundingClientRect = function (this: Range) {
        const top = this.toString() === 'first' ? 10 : 100;
        return { left: 0, right: 50, top, bottom: top + 10, width: 50, height: 10 } as DOMRect;
      };
      a.doc.caretPositionFromPoint = () => ({ offsetNode: textNode(a.doc, 1), offset: 2 }) as never;
      expect(getCaretPositionInText(a.doc, 20, 5)).toEqual({ node: textNode(a.doc, 0), offset: 0 });
      expect(getCaretPositionInText(a.doc, 20, 200)).toEqual({
        node: textNode(a.doc, 1),
        offset: 4,
      });
      expect(getCaretPositionInText(a.doc, 20, 50)).toEqual({
        node: textNode(a.doc, 1),
        offset: 2,
      });
    });
  });

  describe('rangeBetweenPositions', () => {
    it('orders the two positions whichever is dragged first', () => {
      const a = makePage({ left: 0, top: 0, right: 1, bottom: 1 }, ['alpha', 'beta'], 0);
      const p = { node: textNode(a.doc, 0), offset: 1 };
      const q = { node: textNode(a.doc, 1), offset: 2 };
      expect(rangeBetweenPositions(a.doc, p, q)?.toString()).toBe('lphabe');
      expect(rangeBetweenPositions(a.doc, q, p)?.toString()).toBe('lphabe');
      expect(rangeBetweenPositions(a.doc, p, p)).toBeNull();
    });
  });

  describe('getDocTextBounds', () => {
    it('spans from the first to the last non-empty text node', () => {
      const a = makePage({ left: 0, top: 0, right: 1, bottom: 1 }, ['first', ' ', 'last'], 0);
      const bounds = getDocTextBounds(a.doc)!;
      expect(bounds.start).toEqual({ node: textNode(a.doc, 0), offset: 0 });
      expect(bounds.end).toEqual({ node: textNode(a.doc, 2), offset: 4 });
    });

    it('is null for a page without text', () => {
      const a = makePage({ left: 0, top: 0, right: 1, bottom: 1 }, [], 0);
      expect(getDocTextBounds(a.doc)).toBeNull();
    });
  });

  describe('buildCrossDocSegments', () => {
    const rect = { left: 0, top: 0, right: 1, bottom: 1 };

    it('forward: anchor page to its end, pages between in full, target page from its start', () => {
      const a = makePage(rect, ['alpha', 'beta'], 1);
      const mid = makePage(rect, ['middle'], 2);
      const b = makePage(rect, ['gamma', 'delta'], 3);
      const contents = [a, mid, b];
      const segments = buildCrossDocSegments(
        { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 2 } },
        { doc: b.doc, index: 3, pos: { node: textNode(b.doc, 1), offset: 3 } },
        contents,
      );
      expect(segments.map((s) => s.index)).toEqual([1, 2, 3]);
      expect(segments[0]).toMatchObject({
        start: { node: textNode(a.doc, 0), offset: 2 },
        end: { node: textNode(a.doc, 1), offset: 4 },
      });
      expect(segments[1]).toMatchObject({
        start: { node: textNode(mid.doc, 0), offset: 0 },
        end: { node: textNode(mid.doc, 0), offset: 6 },
      });
      expect(segments[2]).toMatchObject({
        start: { node: textNode(b.doc, 0), offset: 0 },
        end: { node: textNode(b.doc, 1), offset: 3 },
      });
    });

    it('backward: the earlier page from the caret to its end, the anchor page up to the anchor', () => {
      const a = makePage(rect, ['alpha', 'beta'], 1);
      const b = makePage(rect, ['gamma', 'delta'], 2);
      const segments = buildCrossDocSegments(
        { doc: b.doc, index: 2, pos: { node: textNode(b.doc, 1), offset: 3 } },
        { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 2 } },
        [a, b],
      );
      expect(segments.map((s) => s.index)).toEqual([1, 2]);
      expect(segments[0]).toMatchObject({
        start: { node: textNode(a.doc, 0), offset: 2 },
        end: { node: textNode(a.doc, 1), offset: 4 },
      });
      expect(segments[1]).toMatchObject({
        start: { node: textNode(b.doc, 0), offset: 0 },
        end: { node: textNode(b.doc, 1), offset: 3 },
      });
    });

    it('drops a collapsed part (anchor at the very end of its page) and same-page input', () => {
      const a = makePage(rect, ['alpha'], 1);
      const b = makePage(rect, ['gamma'], 2);
      const segments = buildCrossDocSegments(
        { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 5 } },
        { doc: b.doc, index: 2, pos: { node: textNode(b.doc, 0), offset: 2 } },
        [a, b],
      );
      expect(segments.map((s) => s.index)).toEqual([2]);
      expect(
        buildCrossDocSegments(
          { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 1 } },
          { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 4 } },
          [a, b],
        ),
      ).toEqual([]);
    });
  });

  describe('applyCrossDocSegments', () => {
    const rect = { left: 0, top: 0, right: 1, bottom: 1 };

    it('selects each segment and clears every other section, keeping the anchor as the base', () => {
      const a = makePage(rect, ['alpha', 'beta'], 1);
      const b = makePage(rect, ['gamma'], 2);
      const stale = makePage(rect, ['stale'], 5);
      stale.doc.getSelection()!.selectAllChildren(stale.doc.body);
      const anchor = { doc: b.doc, index: 2, pos: { node: textNode(b.doc, 0), offset: 3 } };
      const segments = buildCrossDocSegments(
        anchor,
        { doc: a.doc, index: 1, pos: { node: textNode(a.doc, 0), offset: 2 } },
        [a, b, stale],
      );
      applyCrossDocSegments(segments, [a, b, stale], anchor);
      expect(a.doc.getSelection()!.toString()).toBe('phabeta');
      expect(b.doc.getSelection()!.toString()).toBe('gam');
      // Backward drag: the anchor page's selection runs from the anchor back to
      // the page start, so the native drag can keep extending from the anchor.
      expect(b.doc.getSelection()!.anchorNode).toBe(textNode(b.doc, 0));
      expect(b.doc.getSelection()!.anchorOffset).toBe(3);
      expect(stale.doc.getSelection()!.rangeCount).toBe(0);
    });
  });

  describe('setNativeDragFrozen', () => {
    it('makes the page root non-selectable but keeps the text layer selectable', () => {
      const a = makePage({ left: 0, top: 0, right: 1, bottom: 1 }, ['alpha'], 1);
      const layer = a.doc.querySelector<HTMLElement>('.textLayer')!;
      setNativeDragFrozen(a.doc, true);
      expect(a.doc.documentElement.style.userSelect).toBe('none');
      expect(layer.style.userSelect).toBe('text');
      setNativeDragFrozen(a.doc, false);
      expect(a.doc.documentElement.style.userSelect).toBe('');
      expect(layer.style.userSelect).toBe('');
    });
  });
});
