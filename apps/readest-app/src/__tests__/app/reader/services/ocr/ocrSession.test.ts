import { describe, expect, it, vi } from 'vitest';

import { OcrSession, type OcrEngine } from '@/app/reader/services/ocr/ocrSession';
import type { OcrPage } from '@/app/reader/services/ocr/types';
import { OCR_TEXT_LAYER_SELECTOR } from '@/app/reader/utils/ocrTextLayer';

const makePage = (pageIndex: number): OcrPage => ({
  pageIndex,
  width: 1200,
  height: 1800,
  blocks: [
    {
      id: `page-${pageIndex}-line-0`,
      text: `recognized page ${pageIndex}`,
      box: { xMin: 100, yMin: 200, xMax: 600, yMax: 280 },
      writingMode: 'horizontal-tb',
    },
  ],
});

const makeDocument = (pageIndex: number): Document => {
  const doc = document.implementation.createHTMLDocument();
  const image = doc.createElement('img');
  image.src = `blob:page-${pageIndex}`;
  Object.defineProperties(image, {
    naturalWidth: { value: 1200 },
    naturalHeight: { value: 1800 },
  });
  doc.body.append(image);
  return doc;
};

const makePdfDocument = ({ text = '' }: { text?: string } = {}): Document => {
  const doc = document.implementation.createHTMLDocument();
  const canvasContainer = doc.createElement('div');
  canvasContainer.id = 'canvas';
  const canvas = doc.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 2400;
  canvasContainer.append(canvas);
  const textLayer = doc.createElement('div');
  textLayer.className = 'textLayer';
  textLayer.textContent = text;
  doc.body.append(canvasContainer, textLayer);
  return doc;
};

const makeEngine = (): OcrEngine => ({
  recognize: vi.fn(async (_source, { pageIndex }) => makePage(pageIndex)),
  terminate: vi.fn(async () => undefined),
});

describe('OcrSession', () => {
  it('recognizes registered pages only after activation and restores cached reloads', async () => {
    const engine = makeEngine();
    const onPageRecognized = vi.fn();
    const session = new OcrSession({ createEngine: () => engine, onPageRecognized });
    const firstDocument = makeDocument(3);

    await session.processDocument(firstDocument, 3);
    expect(engine.recognize).not.toHaveBeenCalled();

    await session.setEnabled(true);

    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(engine.recognize).toHaveBeenCalledWith('blob:page-3', {
      pageIndex: 3,
      width: 1200,
      height: 1800,
    });
    expect(firstDocument.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe(
      'recognized page 3',
    );
    expect(onPageRecognized).toHaveBeenCalledOnce();
    expect(onPageRecognized).toHaveBeenCalledWith(makePage(3));

    const reloadedDocument = makeDocument(3);
    await session.processDocument(reloadedDocument, 3);

    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(onPageRecognized).toHaveBeenCalledTimes(1);
    expect(reloadedDocument.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe(
      'recognized page 3',
    );
  });

  it('removes overlays and terminates active recognition when disabled', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makeDocument(1);
    await session.processDocument(doc, 1);
    await session.setEnabled(true);

    await session.setEnabled(false);

    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not mount a recognition result that completes after deactivation', async () => {
    let resolveRecognition!: (page: OcrPage) => void;
    const engine = makeEngine();
    vi.mocked(engine.recognize).mockImplementationOnce(
      () =>
        new Promise<OcrPage>((resolve) => {
          resolveRecognition = resolve;
        }),
    );
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makeDocument(4);
    await session.processDocument(doc, 4);

    const activation = session.setEnabled(true);
    await vi.waitFor(() => expect(engine.recognize).toHaveBeenCalledTimes(1));
    await session.setEnabled(false);
    resolveRecognition(makePage(4));
    await activation;

    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
  });

  it('runs page recognition serially through one engine', async () => {
    let resolveFirst!: (page: OcrPage) => void;
    const engine = makeEngine();
    vi.mocked(engine.recognize)
      .mockImplementationOnce(
        () =>
          new Promise<OcrPage>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (_source, { pageIndex }) => makePage(pageIndex));
    const session = new OcrSession({ createEngine: () => engine });
    await session.processDocument(makeDocument(0), 0);
    await session.processDocument(makeDocument(1), 1);

    const activation = session.setEnabled(true);
    await vi.waitFor(() => expect(engine.recognize).toHaveBeenCalledTimes(1));
    resolveFirst(makePage(0));
    await activation;

    expect(engine.recognize).toHaveBeenCalledTimes(2);
  });

  it('recognizes a rendered canvas when a PDF page has no native text', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument();
    const canvas = doc.querySelector('canvas')!;

    await session.setEnabled(true);
    await session.processDocument(doc, 5);

    expect(engine.recognize).toHaveBeenCalledWith(canvas, {
      pageIndex: 5,
      width: 1600,
      height: 2400,
    });
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe('recognized page 5');
  });

  it('does not recognize a PDF page that already has native text', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument({ text: 'Selectable PDF text' });

    await session.setEnabled(true);
    await session.processDocument(doc, 2);

    expect(engine.recognize).not.toHaveBeenCalled();
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
  });

  it('treats a whitespace-only PDF text layer as image-only', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument({ text: ' \n\t ' });

    await session.setEnabled(true);
    await session.processDocument(doc, 4);

    expect(engine.recognize).toHaveBeenCalledTimes(1);
  });

  it('restores cached PDF text after a zoom replaces the rendered canvas', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument();
    await session.setEnabled(true);
    await session.processDocument(doc, 6);
    doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.remove();

    const zoomedCanvas = doc.createElement('canvas');
    zoomedCanvas.width = 2400;
    zoomedCanvas.height = 3600;
    doc.querySelector('#canvas')!.replaceChildren(zoomedCanvas);
    await session.processDocument(doc, 6);

    expect(engine.recognize).toHaveBeenCalledTimes(1);
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe('recognized page 6');
  });
});
