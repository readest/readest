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
          fontSize: 30,
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
      fontSize: '3vw',
      pointerEvents: 'auto',
      userSelect: 'text',
      writingMode: 'vertical-rl',
    });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    text?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe('縦書き<img src=x>');
    const manualRange = document.createRange();
    const nativeText = text!.querySelector('[data-readest-ocr-line]')!.firstChild!;
    manualRange.setStart(nativeText, 0);
    manualRange.setEnd(nativeText, 2);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(manualRange);
    const dragEndClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    text?.dispatchEvent(dragEndClick);
    expect(dragEndClick.defaultPrevented).toBe(false);
    expect(document.getSelection()?.toString()).toBe('縦書');
    expect(document.querySelector('[data-readest-ocr-style]')?.textContent).toContain(
      'background-color: #fff',
    );
    expect(isOcrRange(range)).toBe(true);

    removeOcrTextLayer(document);
    expect(document.querySelector('[data-readest-ocr-layer]')).toBeNull();
  });

  it('switches directly from one OCR block to another', () => {
    const layer = mountOcrTextLayer(document, {
      pageIndex: 3,
      width: 1000,
      height: 2000,
      blocks: [
        {
          id: 'line-0',
          text: '最初',
          box: { xMin: 100, yMin: 100, xMax: 300, yMax: 300 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'line-1',
          text: '次',
          box: { xMin: 400, yMin: 100, xMax: 600, yMax: 300 },
          writingMode: 'horizontal-tb',
        },
      ],
    });
    const first = layer?.querySelector<HTMLElement>('[data-readest-ocr-block-id="line-0"]');
    const second = layer?.querySelector<HTMLElement>('[data-readest-ocr-block-id="line-1"]');
    const selection = document.getSelection();
    const firstRange = document.createRange();
    firstRange.selectNodeContents(first!);
    selection?.removeAllRanges();
    selection?.addRange(firstRange);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    second?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(selection?.toString()).toBe('次');
  });
});
