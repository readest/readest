// @vitest-environment happy-dom
// Overlayer.dashedUnderline draws the copies of a global annotation: a dashed
// line where Overlayer.underline puts its solid one, stroked from a color that
// may be a CSS variable so it follows the theme without a redraw.
import { describe, expect, it } from 'vitest';

import { Overlayer } from 'foliate-js/overlayer.js';

const rects = [
  { left: 10, top: 0, right: 50, bottom: 20, width: 40, height: 20 },
  { left: 0, top: 30, right: 30, bottom: 50, width: 30, height: 20 },
];

const centerOf = (el: Element) => {
  const n = (name: string) => Number(el.getAttribute(name));
  return { x: n('x') + n('width') / 2, y: n('y') + n('height') / 2 };
};

describe('Overlayer.dashedUnderline', () => {
  it('strokes dashes in the given color and opacity', () => {
    const g = Overlayer.dashedUnderline(rects, {
      color: 'var(--color-base-content)',
      opacity: 0.5,
      width: 1,
    });
    expect(g.style.getPropertyValue('stroke')).toBe('var(--color-base-content)');
    expect(g.getAttribute('stroke-opacity')).toBe('0.5');
    expect(g.getAttribute('stroke-width')).toBe('1');
    expect(g.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it.each([
    'horizontal-tb',
    'vertical-rl',
  ])('%s: each line runs along the solid underline for the same rects', (writingMode) => {
    const options = { padding: 3, width: 2, writingMode };
    const solid = [...Overlayer.underline(rects, options).children].map(centerOf);
    const dashed = [...Overlayer.dashedUnderline(rects, options).querySelectorAll('line')];
    const vertical = writingMode === 'vertical-rl';
    expect(dashed).toHaveLength(rects.length);
    dashed.forEach((line, i) => {
      const n = (name: string) => Number(line.getAttribute(name));
      const rect = rects[i]!;
      if (vertical) {
        expect([n('x1'), n('x2')]).toEqual([solid[i]!.x, solid[i]!.x]);
        expect([n('y1'), n('y2')]).toEqual([rect.top, rect.bottom]);
      } else {
        expect([n('y1'), n('y2')]).toEqual([solid[i]!.y, solid[i]!.y]);
        expect([n('x1'), n('x2')]).toEqual([rect.left, rect.right]);
      }
    });
  });
});
