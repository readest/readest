import { beforeEach, describe, expect, it } from 'vitest';

import { mountOcrTextLayer, removeOcrTextLayer } from '@/app/reader/utils/ocrTextLayer';
import { isOcrRange } from '@/utils/sel';

describe('OCR text layer', () => {
  beforeEach(() => document.body.replaceChildren(document.createElement('img')));

  it('mounts safe selectable Japanese text and identifies its transient range', () => {
    const layer = mountOcrTextLayer(document, {
      pageIndex: 3,
      width: 1000,
      height: 2000,
      language: 'ja',
      blocks: [
        {
          id: 'line-0',
          text: '縦書き<img src=x>',
          lines: ['縦書き', '<img src=x>'],
          box: { xMin: 800, yMin: 400, xMax: 900, yMax: 1000 },
          writingMode: 'vertical-rl',
        },
      ],
    });
    const text = layer?.querySelector<HTMLElement>('[data-readest-ocr-block-id="line-0"]');
    const range = document.createRange();
    range.selectNodeContents(text!);

    expect(layer?.lang).toBe('ja');
    expect(text?.textContent).toBe('縦書き<img src=x>');
    expect(text?.querySelectorAll('[data-readest-ocr-line]')).toHaveLength(2);
    expect(text?.querySelector('img')).toBeNull();
    expect(text?.style).toMatchObject({
      cursor: 'vertical-text',
      pointerEvents: 'auto',
      userSelect: 'text',
      writingMode: 'vertical-rl',
    });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    text?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe('縦書き<img src=x>');
    const manualRange = document.createRange();
    manualRange.selectNodeContents(text!.firstChild!);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(manualRange);
    const dragEndClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    text?.dispatchEvent(dragEndClick);
    expect(dragEndClick.defaultPrevented).toBe(false);
    expect(document.getSelection()?.toString()).toBe('縦書き');
    expect(document.querySelector('[data-readest-ocr-style]')?.textContent).toContain(
      'background-color: #fff',
    );
    expect(isOcrRange(range)).toBe(true);

    removeOcrTextLayer(document);
    expect(document.querySelector('[data-readest-ocr-layer]')).toBeNull();
  });
});
