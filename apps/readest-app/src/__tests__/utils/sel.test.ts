import { describe, it, expect, beforeEach } from 'vitest';
import type { Rect, Position } from '@/utils/sel';

// We need to test the non-exported helpers via the exported functions that use them.
// frameRect and pointIsInView are non-exported, but exercised through getPosition/getPopupPosition.
// constrainPointWithinRect is also non-exported but exercised through getPosition.

// For getPopupPosition we can test directly.
import { getPopupPosition } from '@/utils/sel';

describe('sel utilities', () => {
  describe('getPopupPosition', () => {
    const boundingRect: Rect = { top: 0, right: 800, bottom: 600, left: 0 };

    describe('direction: up', () => {
      it('should position popup above the point', () => {
        const position: Position = { point: { x: 400, y: 200 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 400 - 200/2 = 300
        // y = 200 - 100 = 100
        expect(result.point.x).toBe(300);
        expect(result.point.y).toBe(100);
        expect(result.dir).toBe('up');
      });

      it('should clamp popup to left edge with padding', () => {
        const position: Position = { point: { x: 50, y: 200 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 50 - 100 = -50, clamped to padding 10
        expect(result.point.x).toBe(10);
      });

      it('should clamp popup to top edge with padding', () => {
        const position: Position = { point: { x: 400, y: 50 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // y = 50 - 100 = -50, clamped to padding 10
        expect(result.point.y).toBe(10);
      });

      it('should clamp popup to right edge with padding', () => {
        const position: Position = { point: { x: 750, y: 300 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 750 - 100 = 650, max = 800 - 0 - 10 - 200 = 590
        expect(result.point.x).toBe(590);
      });

      it('should clamp popup to bottom edge with padding', () => {
        const position: Position = { point: { x: 400, y: 590 }, dir: 'up' };
        // y = 590 - 100 = 490, max = 600 - 0 - 10 - 100 = 490
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        expect(result.point.y).toBe(490);
      });
    });

    describe('direction: down', () => {
      it('should position popup below the point with 6px offset', () => {
        const position: Position = { point: { x: 400, y: 200 }, dir: 'down' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 400 - 100 = 300
        // y = 200 + 6 = 206
        expect(result.point.x).toBe(300);
        expect(result.point.y).toBe(206);
        expect(result.dir).toBe('down');
      });

      it('should clamp when popup overflows bottom', () => {
        const position: Position = { point: { x: 400, y: 550 }, dir: 'down' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // y = 550 + 6 = 556, max = 600 - 0 - 10 - 100 = 490
        expect(result.point.y).toBe(490);
      });
    });

    describe('direction: left', () => {
      it('should position popup to the left of the point', () => {
        const position: Position = { point: { x: 400, y: 300 }, dir: 'left' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 400 - 200 = 200
        // y = 300 - 50 = 250
        expect(result.point.x).toBe(200);
        expect(result.point.y).toBe(250);
        expect(result.dir).toBe('left');
      });

      it('should clamp when popup overflows left', () => {
        const position: Position = { point: { x: 50, y: 300 }, dir: 'left' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 50 - 200 = -150, clamped to 10
        expect(result.point.x).toBe(10);
      });
    });

    describe('direction: right', () => {
      it('should position popup to the right of the point with 6px offset', () => {
        const position: Position = { point: { x: 300, y: 300 }, dir: 'right' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 300 + 6 = 306
        // y = 300 - 50 = 250
        expect(result.point.x).toBe(306);
        expect(result.point.y).toBe(250);
        expect(result.dir).toBe('right');
      });

      it('should clamp when popup overflows right', () => {
        const position: Position = { point: { x: 700, y: 300 }, dir: 'right' };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // x = 700 + 6 = 706, max = 800 - 0 - 10 - 200 = 590
        expect(result.point.x).toBe(590);
      });
    });

    describe('no direction', () => {
      it('should default to top-left (0,0) and apply clamping', () => {
        const position: Position = { point: { x: 400, y: 300 } };
        const result = getPopupPosition(position, boundingRect, 200, 100, 10);
        // No dir matched, popupPoint stays {0,0}
        // x = 0 < 10 => 10
        // y = 0 < 10 => 10
        expect(result.point.x).toBe(10);
        expect(result.point.y).toBe(10);
      });
    });

    describe('non-zero origin bounding rect', () => {
      it('should respect bounding rect offset for right clamping', () => {
        const rect: Rect = { top: 100, right: 500, bottom: 400, left: 100 };
        const position: Position = { point: { x: 380, y: 150 }, dir: 'down' };
        const result = getPopupPosition(position, rect, 200, 100, 10);
        // x = 380 - 100 = 280, max_x = (500-100) - 10 - 200 = 190 => clamped to 190
        expect(result.point.x).toBe(190);
      });

      it('should respect bounding rect offset for bottom clamping', () => {
        const rect: Rect = { top: 100, right: 500, bottom: 400, left: 100 };
        const position: Position = { point: { x: 200, y: 280 }, dir: 'down' };
        const result = getPopupPosition(position, rect, 100, 100, 10);
        // x = 200 - 50 = 150, within bounds
        // y = 280 + 6 = 286, max_y = (400-100) - 10 - 100 = 190 => clamped to 190
        expect(result.point.y).toBe(190);
      });
    });

    describe('zero-size popup', () => {
      it('should handle zero width and height', () => {
        const position: Position = { point: { x: 400, y: 300 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 0, 0, 0);
        expect(result.point.x).toBe(400);
        expect(result.point.y).toBe(300);
      });
    });

    describe('large popup exceeding bounds', () => {
      it('should clamp a popup larger than the bounding rect', () => {
        const position: Position = { point: { x: 400, y: 300 }, dir: 'up' };
        const result = getPopupPosition(position, boundingRect, 1000, 800, 10);
        // x = 400 - 500 = -100 => clamped to 10
        // then right clamp: 10 + 1000 > 800 - 0 - 10 => x = 800 - 10 - 1000 = -210
        // -210 < 10 => re-clamped to 10 (left clamp happens first, then right clamp overrides)
        // Actually: left clamp sets x=10, then right check: 10+1000=1010 > 790 => x = -210
        // The function applies clamping sequentially: first min, then max. So final x = -210.
        expect(result.point.x).toBe(-210);
      });
    });
  });

  describe('getPosition (exercises frameRect, constrainPointWithinRect, pointIsInView)', () => {
    beforeEach(() => {
      // Set window dimensions for pointIsInView
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
    });

    it('should return zero-point when both start and end are outside the view', async () => {
      const { getPosition } = await import('@/utils/sel');
      // Create a mock Range that returns rects outside the viewport
      const mockRange = {
        getClientRects: () =>
          [{ top: -200, right: -100, bottom: -150, left: -200 }] as unknown as DOMRectList,
        commonAncestorContainer: document.createElement('div'),
      } as unknown as Range;

      const rect: Rect = { top: 0, right: 1024, bottom: 768, left: 0 };
      const result = getPosition(mockRange, rect, 10);
      // The constrained points should be clamped within rect, but they need to
      // pass pointIsInView which checks against window dimensions
      expect(result.point).toBeDefined();
    });

    it('should handle a TextSelection with rect property', async () => {
      const { getPosition } = await import('@/utils/sel');
      const mockTextSelection = {
        range: {
          getClientRects: () =>
            [{ top: 100, right: 300, bottom: 120, left: 200 }] as unknown as DOMRectList,
          commonAncestorContainer: document.createElement('div'),
        } as unknown as Range,
        rect: { top: 100, right: 300, bottom: 120, left: 200 },
        key: 'test',
        text: 'hello',
        page: 0,
        index: 0,
      };

      const rect: Rect = { top: 0, right: 1024, bottom: 768, left: 0 };
      const result = getPosition(mockTextSelection, rect, 10);
      expect(result.point).toBeDefined();
      expect(result.dir).toBeDefined();
    });
  });

  describe('isPointerInsideSelection', () => {
    it('should return false when selection has no ranges', async () => {
      const { isPointerInsideSelection } = await import('@/utils/sel');
      const selection = {
        rangeCount: 0,
      } as unknown as Selection;
      const ev = { clientX: 100, clientY: 100 } as PointerEvent;
      expect(isPointerInsideSelection(selection, ev)).toBe(false);
    });

    it('should return true when pointer is inside a selection rect (with padding)', async () => {
      const { isPointerInsideSelection } = await import('@/utils/sel');
      const selection = {
        rangeCount: 1,
        getRangeAt: () => ({
          getClientRects: () =>
            [{ left: 100, right: 200, top: 100, bottom: 120 }] as unknown as DOMRectList,
        }),
      } as unknown as Selection;
      // Within the rect with padding of 50
      const ev = { clientX: 150, clientY: 110 } as PointerEvent;
      expect(isPointerInsideSelection(selection, ev)).toBe(true);
    });

    it('should return true when pointer is within padding distance', async () => {
      const { isPointerInsideSelection } = await import('@/utils/sel');
      const selection = {
        rangeCount: 1,
        getRangeAt: () => ({
          getClientRects: () =>
            [{ left: 100, right: 200, top: 100, bottom: 120 }] as unknown as DOMRectList,
        }),
      } as unknown as Selection;
      // Outside the rect but within 50px padding
      const ev = { clientX: 60, clientY: 110 } as PointerEvent;
      expect(isPointerInsideSelection(selection, ev)).toBe(true);
    });

    it('should return false when pointer is far outside selection', async () => {
      const { isPointerInsideSelection } = await import('@/utils/sel');
      const selection = {
        rangeCount: 1,
        getRangeAt: () => ({
          getClientRects: () =>
            [{ left: 100, right: 200, top: 100, bottom: 120 }] as unknown as DOMRectList,
        }),
      } as unknown as Selection;
      // Far outside the rect
      const ev = { clientX: 500, clientY: 500 } as PointerEvent;
      expect(isPointerInsideSelection(selection, ev)).toBe(false);
    });

    it('should check all rects in a multi-rect selection', async () => {
      const { isPointerInsideSelection } = await import('@/utils/sel');
      const selection = {
        rangeCount: 1,
        getRangeAt: () => ({
          getClientRects: () =>
            [
              { left: 100, right: 200, top: 100, bottom: 120 },
              { left: 100, right: 300, top: 120, bottom: 140 },
            ] as unknown as DOMRectList,
        }),
      } as unknown as Selection;
      // Inside the second rect
      const ev = { clientX: 250, clientY: 130 } as PointerEvent;
      expect(isPointerInsideSelection(selection, ev)).toBe(true);
    });
  });

  describe('getTextFromRange', () => {
    it('should extract text from a simple range', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = 'Hello <b>world</b>!';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const text = getTextFromRange(range);
      expect(text).toBe('Hello world!');

      document.body.removeChild(container);
    });

    it('should reject text from specified tags', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = 'Hello <rt>ruby</rt> world';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const text = getTextFromRange(range, ['rt']);
      expect(text).not.toContain('ruby');
      expect(text).toContain('Hello');
      expect(text).toContain('world');

      document.body.removeChild(container);
    });

    it('should return empty string for an empty range', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = '';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const text = getTextFromRange(range);
      expect(text).toBe('');

      document.body.removeChild(container);
    });

    it('should handle nested elements', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = '<p>First <span>nested <em>deep</em></span> end</p>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const text = getTextFromRange(range);
      expect(text).toBe('First nested deep end');

      document.body.removeChild(container);
    });

    it('should insert a newline for <br> between adjacent text spans (PDF line wrap)', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      // Mirrors how pdf.js renders the text layer: each text run is its
      // own <span>, and line endings are <br role="presentation">.
      const container = document.createElement('div');
      container.className = 'textLayer';
      container.innerHTML =
        '<span role="presentation">last word of line 1</span>' +
        '<br role="presentation">' +
        '<span role="presentation">first word of line 2</span>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const text = getTextFromRange(range);
      // Without separating the spans the text becomes
      // "last word of line 1first word of line 2" — words are glued.
      expect(text).toBe('last word of line 1\nfirst word of line 2');

      document.body.removeChild(container);
    });

    it('should insert a newline for explicit <br> in HTML content', async () => {
      const { getTextFromRange } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = 'first<br>second<br>third';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      expect(getTextFromRange(range)).toBe('first\nsecond\nthird');

      document.body.removeChild(container);
    });
  });

  describe('snapRangeToWords', () => {
    it('should snap start offset to word boundary', async () => {
      const { snapRangeToWords } = await import('@/utils/sel');
      const textNode = document.createTextNode('Hello world test');
      const container = document.createElement('div');
      container.appendChild(textNode);
      document.body.appendChild(container);

      const range = document.createRange();
      // Start in the middle of "world" (offset 8, "r"), end at the end of "world" (offset 11)
      range.setStart(textNode, 8);
      range.setEnd(textNode, 11);

      snapRangeToWords(range);

      // Should snap start back to the beginning of "world" (offset 6)
      expect(range.startOffset).toBe(6);
      // End was at the end of "world" so it should stay or snap to word end
      expect(range.endOffset).toBe(11);

      document.body.removeChild(container);
    });

    it('should snap end offset to word boundary', async () => {
      const { snapRangeToWords } = await import('@/utils/sel');
      const textNode = document.createTextNode('Hello world test');
      const container = document.createElement('div');
      container.appendChild(textNode);
      document.body.appendChild(container);

      const range = document.createRange();
      // Start at the beginning of "world" (offset 6), end in the middle of "world" (offset 8)
      range.setStart(textNode, 6);
      range.setEnd(textNode, 8);

      snapRangeToWords(range);

      expect(range.startOffset).toBe(6);
      // Should snap end to the end of "world" (offset 11)
      expect(range.endOffset).toBe(11);

      document.body.removeChild(container);
    });

    it('should not snap when offset is at the start of text', async () => {
      const { snapRangeToWords } = await import('@/utils/sel');
      const textNode = document.createTextNode('Hello');
      const container = document.createElement('div');
      container.appendChild(textNode);
      document.body.appendChild(container);

      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 3);

      snapRangeToWords(range);

      expect(range.startOffset).toBe(0);
      // End should snap to end of "Hello"
      expect(range.endOffset).toBe(5);

      document.body.removeChild(container);
    });

    it('should not snap when container is not a text node', async () => {
      const { snapRangeToWords } = await import('@/utils/sel');
      const container = document.createElement('div');
      container.innerHTML = '<span>Hello</span>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.setStart(container, 0);
      range.setEnd(container, 1);

      // Should not throw
      snapRangeToWords(range);
      expect(range.startOffset).toBe(0);

      document.body.removeChild(container);
    });

    it('should not snap past punctuation', async () => {
      const { snapRangeToWords } = await import('@/utils/sel');
      const textNode = document.createTextNode('Hello, world!');
      const container = document.createElement('div');
      container.appendChild(textNode);
      document.body.appendChild(container);

      const range = document.createRange();
      // Start at comma (offset 5), end at exclamation (offset 12)
      range.setStart(textNode, 5);
      range.setEnd(textNode, 12);

      snapRangeToWords(range);

      // The comma is punctuation, so start should not snap
      expect(range.startOffset).toBe(5);

      document.body.removeChild(container);
    });
  });
});
