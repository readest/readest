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
    const onError = vi.fn();
    const session = new OcrSession({ createEngine: () => engine, onError });

    try {
      await session.processDocument(firstPage.doc, 3);
      const append = vi.spyOn(firstPage.doc.body, 'append');
      const enabled = session.setEnabled(true);
      const pending = session.processDocument(firstPage.doc, 3, { priority: true });
      await Promise.all([enabled, pending]);
      expect(append).toHaveBeenCalledOnce();

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

      const oldLayer = secondPage.doc.querySelector(OCR_TEXT_LAYER_SELECTOR);
      secondPage.doc.querySelector('img')!.src = 'blob:replacement-page';
      const replacementAppend = vi.spyOn(secondPage.doc.body, 'append');
      await Promise.all([
        session.processDocument(secondPage.doc, 3),
        session.processDocument(secondPage.doc, 3),
      ]);
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(secondPage.doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).not.toBe(oldLayer);
      expect(replacementAppend).toHaveBeenCalledOnce();

      secondPage.doc.querySelector('img')!.src = 'blob:failed-page';
      vi.mocked(engine.recognize).mockRejectedValueOnce(new Error('Recognition failed'));
      await Promise.all([
        session.processDocument(secondPage.doc, 3),
        session.processDocument(secondPage.doc, 3, { priority: true }),
      ]);
      expect(onError).toHaveBeenCalledOnce();

      let failStale!: (error: Error) => void;
      vi.mocked(engine.recognize).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failStale = reject;
          }),
      );
      const stale = session.processDocument(secondPage.doc, 3);
      await vi.waitFor(() => expect(failStale).toBeDefined());
      secondPage.doc.querySelector('img')!.src = 'blob:recovered-page';
      const recovered = session.processDocument(secondPage.doc, 3);
      failStale(new Error('Obsolete recognition failed'));
      await Promise.all([stale, recovered]);
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      await session.terminate();
      for (const { iframe } of pages) iframe.remove();
    }
  });

  it('skips obsolete queued pages and releases unloaded canvas results', async () => {
    const frames = [0, 1, 2].map(() => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      return iframe;
    });
    const [active, changed, hidden] = frames.map((frame) => frame.contentDocument!);
    for (const doc of [active!, hidden!]) {
      const container = doc.createElement('div');
      container.id = 'canvas';
      const canvas = doc.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1800;
      container.append(canvas);
      doc.body.append(container);
    }
    const image = changed!.createElement('img');
    image.src = 'blob:obsolete-page';
    Object.defineProperties(image, {
      naturalWidth: { value: 1200 },
      naturalHeight: { value: 1800 },
    });
    changed!.body.append(image);

    let finishFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const engine: OcrEngine = {
      recognize: vi.fn(async (_source, page) => {
        if (page.pageIndex === 0) await firstRun;
        return { ...page, blocks: [] };
      }),
      terminate: vi.fn(async () => undefined),
    };
    const session = new OcrSession({ createEngine: () => engine });
    try {
      await session.setEnabled(true);
      const current = session.processDocument(active!, 0);
      await vi.waitFor(() => expect(engine.recognize).toHaveBeenCalledOnce());
      const canceled: unknown[] = [];
      const obsolete = session.processDocument(changed!, 1).then((page) => canceled.push(page));
      image.src = 'blob:current-page';
      const replacement = session.processDocument(changed!, 1);
      const unloaded = session.processDocument(hidden!, 2).then((page) => canceled.push(page));
      frames[2]!.contentWindow!.dispatchEvent(new Event('pagehide'));
      await vi.waitFor(() => expect(canceled).toEqual([null, null]));

      finishFirst();
      await Promise.all([current, obsolete, replacement, unloaded]);
      expect(
        vi.mocked(engine.recognize).mock.calls.map(([source, page]) => [source, page.pageIndex]),
      ).toEqual([
        [active!.querySelector('canvas'), 0],
        ['blob:current-page', 1],
      ]);

      frames[0]!.contentWindow!.dispatchEvent(new Event('pagehide'));
      await session.processDocument(active!, 0);
      expect(engine.recognize).toHaveBeenCalledTimes(3);
    } finally {
      finishFirst();
      await session.terminate();
      for (const frame of frames) frame.remove();
    }
  });
});
