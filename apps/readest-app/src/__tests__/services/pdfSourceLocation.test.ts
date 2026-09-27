import { describe, expect, it, vi } from 'vitest';

import { pdfPointFromRange } from '@/services/pdfSourceLocation';

describe('PDF selection to SyncTeX coordinates', () => {
  it('maps the selection center from rendered CSS pixels to page big points', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=600, height=800">';
    document.body.innerHTML = '<div id="canvas"><canvas></canvas></div><span>selection</span>';
    const canvas = document.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 1200,
      height: 1600,
    } as DOMRect);
    const text = document.querySelector('span')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: vi.fn().mockReturnValue({
        left: 590,
        top: 780,
        width: 40,
        height: 80,
      } as DOMRect),
    });

    expect(pdfPointFromRange(range)).toEqual({ x: 300, y: 400 });
  });

  it('returns null outside a rendered PDF page', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<span>selection</span>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('span')!);

    expect(pdfPointFromRange(range)).toBeNull();
  });
});
