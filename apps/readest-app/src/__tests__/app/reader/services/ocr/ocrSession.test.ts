import { describe, expect, it, vi } from 'vitest';

import { OcrSession, type OcrEngine } from '@/app/reader/services/ocr/ocrSession';
import { OCR_TEXT_LAYER_SELECTOR } from '@/app/reader/utils/ocrTextLayer';

describe('OcrSession', () => {
  it('keeps recognition and its selectable layer inside the active session', async () => {
    const doc = document.implementation.createHTMLDocument();
    const image = doc.createElement('img');
    image.src = 'blob:manga-page';
    Object.defineProperties(image, {
      naturalWidth: { value: 1200 },
      naturalHeight: { value: 1800 },
    });
    doc.body.append(image);
    const engine: OcrEngine = {
      recognize: vi.fn(async () => ({
        pageIndex: 3,
        width: 1200,
        height: 1800,
        language: 'ja',
        blocks: [
          {
            id: 'line-0',
            text: '日本語',
            box: { xMin: 100, yMin: 200, xMax: 600, yMax: 280 },
            writingMode: 'horizontal-tb' as const,
          },
        ],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const session = new OcrSession({ createEngine: () => engine });

    await session.processDocument(doc, 3);
    expect(engine.recognize).not.toHaveBeenCalled();

    await session.setEnabled(true);
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe('日本語');

    await session.setEnabled(false);
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
    expect(engine.terminate).toHaveBeenCalledOnce();
  });

  it('reuses cached pages without remounting and releases hidden documents', async () => {
    const pages = [0, 1].map(() => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      const doc = iframe.contentDocument!;
      const image = doc.createElement('img');
      image.src = 'blob:manga-page';
      Object.defineProperties(image, {
        naturalWidth: { value: 1200 },
        naturalHeight: { value: 1800 },
      });
      doc.body.append(image);
      return { doc, iframe };
    });
    const firstPage = pages[0]!;
    const secondPage = pages[1]!;
    const engine: OcrEngine = {
      recognize: vi.fn(async () => ({
        pageIndex: 3,
        width: 1200,
        height: 1800,
        language: 'ja',
        blocks: [
          {
            id: 'line-0',
            text: '日本語',
            box: { xMin: 100, yMin: 200, xMax: 600, yMax: 280 },
            writingMode: 'horizontal-tb' as const,
          },
        ],
      })),
      terminate: vi.fn(async () => undefined),
    };
    const session = new OcrSession({ createEngine: () => engine });

    try {
      await session.processDocument(firstPage.doc, 3);
      await session.setEnabled(true);

      const layer = firstPage.doc.querySelector(OCR_TEXT_LAYER_SELECTOR)!;
      const block = layer.querySelector('[data-readest-ocr-block-id]')!;
      const selection = firstPage.doc.getSelection()!;
      const range = firstPage.doc.createRange();
      range.selectNodeContents(block);
      selection.removeAllRanges();
      selection.addRange(range);
      const anchorNode = selection.anchorNode;

      await session.processDocument(firstPage.doc, 3);
      expect(firstPage.doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBe(layer);
      expect(selection.toString()).toBe('日本語');
      expect(selection.anchorNode).toBe(anchorNode);

      firstPage.iframe.contentWindow!.dispatchEvent(new Event('pagehide'));
      await session.processDocument(secondPage.doc, 3);
      expect(engine.recognize).toHaveBeenCalledOnce();
      expect(secondPage.doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe('日本語');
    } finally {
      await session.terminate();
      for (const { iframe } of pages) iframe.remove();
    }
  });
});
