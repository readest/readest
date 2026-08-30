import { beforeEach, describe, expect, it } from 'vitest';

import type { OcrPage } from '@/app/reader/services/ocr/types';
import { mountOcrTextLayer, OCR_TEXT_LAYER_SELECTOR } from '@/app/reader/utils/ocrTextLayer';

const makePage = (overrides: Partial<OcrPage> = {}): OcrPage => ({
  pageIndex: 3,
  width: 1000,
  height: 2000,
  blocks: [
    {
      id: 'horizontal-0',
      text: 'safe <img src=x onerror=alert(1)> text',
      box: { xMin: 100, yMin: 200, xMax: 500, yMax: 300 },
      writingMode: 'horizontal-tb',
    },
    {
      id: 'vertical-0',
      text: '縦書き',
      box: { xMin: 800, yMin: 400, xMax: 900, yMax: 1000 },
      writingMode: 'vertical-rl',
    },
  ],
  ...overrides,
});

describe('mountOcrTextLayer', () => {
  beforeEach(() => {
    document.body.replaceChildren(document.createElement('img'));
  });

  it('mounts safe, selectable text at source-relative coordinates', () => {
    const layer = mountOcrTextLayer(document, makePage());

    expect(layer).not.toBeNull();
    expect(document.querySelectorAll(OCR_TEXT_LAYER_SELECTOR)).toHaveLength(1);
    expect(layer?.getAttribute('data-readest-ocr-page-index')).toBe('3');
    expect(layer?.style.pointerEvents).toBe('none');

    const horizontal = layer?.querySelector<HTMLElement>(
      '[data-readest-ocr-block-id="horizontal-0"]',
    );
    expect(horizontal?.textContent).toBe('safe <img src=x onerror=alert(1)> text');
    expect(horizontal?.querySelector('img')).toBeNull();
    expect(horizontal?.style.left).toBe('10%');
    expect(horizontal?.style.top).toBe('10%');
    expect(horizontal?.style.width).toBe('40%');
    expect(horizontal?.style.height).toBe('5%');
    expect(horizontal?.style.fontSize).toBe('5vh');
    expect(horizontal?.style.pointerEvents).toBe('auto');
    expect(horizontal?.style.userSelect).toBe('text');

    const range = document.createRange();
    range.selectNodeContents(horizontal!);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    expect(document.getSelection()?.toString()).toBe('safe <img src=x onerror=alert(1)> text');
  });

  it('uses vertical writing metrics for vertical OCR text', () => {
    const layer = mountOcrTextLayer(document, makePage());
    const vertical = layer?.querySelector<HTMLElement>('[data-readest-ocr-block-id="vertical-0"]');

    expect(vertical?.style.writingMode).toBe('vertical-rl');
    expect(vertical?.style.fontSize).toBe('10vw');
    expect(vertical?.style.textOrientation).toBe('mixed');
  });

  it('clamps oversized boxes and skips empty, non-finite, or degenerate blocks', () => {
    const page = makePage({
      blocks: [
        {
          id: 'clamped',
          text: 'clamped',
          box: { xMin: -100, yMin: -200, xMax: 1200, yMax: 2200 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'empty',
          text: '   ',
          box: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'non-finite',
          text: 'invalid',
          box: { xMin: 0, yMin: 0, xMax: Number.POSITIVE_INFINITY, yMax: 10 },
          writingMode: 'horizontal-tb',
        },
        {
          id: 'degenerate',
          text: 'invalid',
          box: { xMin: 20, yMin: 20, xMax: 10, yMax: 10 },
          writingMode: 'horizontal-tb',
        },
      ],
    });

    const layer = mountOcrTextLayer(document, page);
    const clamped = layer?.querySelector<HTMLElement>('[data-readest-ocr-block-id="clamped"]');

    expect(layer?.children).toHaveLength(1);
    expect(clamped?.style.left).toBe('0%');
    expect(clamped?.style.top).toBe('0%');
    expect(clamped?.style.width).toBe('100%');
    expect(clamped?.style.height).toBe('100%');
  });

  it('replaces a stale layer and removes it when page dimensions are invalid', () => {
    mountOcrTextLayer(document, makePage());
    const replacement = mountOcrTextLayer(document, makePage({ pageIndex: 4 }));

    expect(document.querySelectorAll(OCR_TEXT_LAYER_SELECTOR)).toHaveLength(1);
    expect(replacement?.getAttribute('data-readest-ocr-page-index')).toBe('4');

    expect(mountOcrTextLayer(document, makePage({ width: 0 }))).toBeNull();
    expect(document.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
  });
});
