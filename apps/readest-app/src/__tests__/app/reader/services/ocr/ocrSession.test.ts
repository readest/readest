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

const makePdfDocument = ({
  text = '',
  withImage = false,
}: {
  text?: string;
  withImage?: boolean;
} = {}): Document => {
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
  if (withImage) {
    const image = doc.createElement('img');
    image.src = 'blob:arbitrary-image';
    Object.defineProperties(image, {
      naturalWidth: { value: 800 },
      naturalHeight: { value: 1200 },
    });
    doc.body.append(image);
  }
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

  it('prioritizes pages in their most recently registered order', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const first = makeDocument(5);
    const current = makeDocument(7);
    await session.processDocument(first, 5);
    await session.processDocument(current, 7);

    await session.processDocument(current, 7);
    await session.processDocument(first, 5);
    await session.setEnabled(true);

    expect(engine.recognize).toHaveBeenNthCalledWith(1, 'blob:page-7', {
      pageIndex: 7,
      width: 1200,
      height: 1800,
    });
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

  it('prefers a PDF canvas over an arbitrary image', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument({ withImage: true });
    const canvas = doc.querySelector('canvas')!;

    await session.setEnabled(true);
    await session.processDocument(doc, 8);

    expect(engine.recognize).toHaveBeenCalledWith(canvas, {
      pageIndex: 8,
      width: 1600,
      height: 2400,
    });
  });

  it('suppresses PDF OCR when native text exists even if an image is present', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument({ text: 'Selectable PDF text', withImage: true });

    await session.setEnabled(true);
    await session.processDocument(doc, 9);

    expect(engine.recognize).not.toHaveBeenCalled();
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
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

  it('recognizes a PDF again after a zoom replaces the rendered canvas', async () => {
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

    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith(zoomedCanvas, {
      pageIndex: 6,
      width: 2400,
      height: 3600,
    });
    expect(doc.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe('recognized page 6');
  });

  it('reruns when the same PDF canvas changes size and reuses unchanged dimensions', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    const doc = makePdfDocument();
    const canvas = doc.querySelector('canvas')!;

    await session.setEnabled(true);
    await session.processDocument(doc, 7);

    canvas.width = 2000;
    canvas.height = 3000;
    await session.processDocument(doc, 7);
    await session.processDocument(doc, 7);

    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith(canvas, {
      pageIndex: 7,
      width: 2000,
      height: 3000,
    });
  });

  it('recognizes a different image that reuses a page index', async () => {
    const engine = makeEngine();
    const session = new OcrSession({ createEngine: () => engine });
    await session.setEnabled(true);
    await session.processDocument(makeDocument(3), 3);

    await session.processDocument(makeDocument(4), 3);

    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith('blob:page-4', {
      pageIndex: 3,
      width: 1200,
      height: 1800,
    });
  });

  it('does not reuse pending recognition for a different image at the same index', async () => {
    let finishFirst!: (page: OcrPage) => void;
    const engine = makeEngine();
    vi.mocked(engine.recognize).mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const session = new OcrSession({ createEngine: () => engine });
    const firstDocument = makeDocument(3);
    const secondDocument = makeDocument(4);
    await session.setEnabled(true);

    const first = session.processDocument(firstDocument, 3);
    await vi.waitFor(() => expect(engine.recognize).toHaveBeenCalledOnce());
    const second = session.processDocument(secondDocument, 3);
    finishFirst(makePage(3));
    await Promise.all([first, second]);

    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenLastCalledWith('blob:page-4', {
      pageIndex: 3,
      width: 1200,
      height: 1800,
    });
    expect(firstDocument.querySelector(OCR_TEXT_LAYER_SELECTOR)).toBeNull();
    expect(secondDocument.querySelector(OCR_TEXT_LAYER_SELECTOR)?.textContent).toBe(
      'recognized page 3',
    );
  });

  it('waits for old engine termination before starting replacement work', async () => {
    let finishTermination!: () => void;
    const firstEngine = makeEngine();
    vi.mocked(firstEngine.terminate).mockImplementationOnce(
      () => new Promise((resolve) => (finishTermination = resolve)),
    );
    const secondEngine = makeEngine();
    const createEngine = vi.fn().mockReturnValueOnce(firstEngine).mockReturnValue(secondEngine);
    const session = new OcrSession({ createEngine });
    await session.setEnabled(true);
    await session.processDocument(makeDocument(3), 3);

    const disabling = session.setEnabled(false);
    await vi.waitFor(() => expect(firstEngine.terminate).toHaveBeenCalledOnce());
    await session.processDocument(makeDocument(4), 3);
    const enabling = session.setEnabled(true);
    await Promise.resolve();

    expect(createEngine).toHaveBeenCalledOnce();
    finishTermination();
    await Promise.all([disabling, enabling]);

    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(secondEngine.recognize).toHaveBeenCalledWith('blob:page-4', {
      pageIndex: 3,
      width: 1200,
      height: 1800,
    });
  });
});
