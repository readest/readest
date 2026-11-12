import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOcrSession } from '@/app/reader/hooks/useOcrSession';
import { OcrPluginEngine } from '@/app/reader/services/ocr/ocrPluginEngine';
import { TesseractOcrEngine } from '@/plugins/ocr/tesseractEngine';

it('keeps OCR available when the webview cannot process canvases in a worker', async () => {
  vi.stubGlobal('OffscreenCanvas', undefined);
  vi.stubGlobal('createImageBitmap', undefined);
  const page = { pageIndex: 0, width: 100, height: 100 };
  const source = document.createElement('canvas');
  const recognize = vi
    .spyOn(TesseractOcrEngine.prototype, 'recognize')
    .mockResolvedValue({ ...page, blocks: [] });
  const terminate = vi.spyOn(TesseractOcrEngine.prototype, 'terminate').mockResolvedValue();
  const engine = new OcrPluginEngine({ languages: ['eng'] });
  try {
    await expect(engine.recognize(source, page)).resolves.toMatchObject(page);
    expect(recognize).toHaveBeenCalledWith(source, page, undefined);
    await engine.terminate();
    expect(terminate).toHaveBeenCalledOnce();
  } finally {
    await engine.terminate();
    recognize.mockRestore();
    terminate.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('keeps the notification pending when an old page finishes after navigation', async () => {
  const docs = [0, 1].map((index) => {
    const doc = document.implementation.createHTMLDocument();
    const image = doc.createElement('img');
    image.src = `blob:page-${index}`;
    Object.defineProperties(image, {
      naturalWidth: { value: 100 },
      naturalHeight: { value: 100 },
    });
    doc.body.append(image);
    return { doc, index };
  });
  const finish: (() => void)[] = [];
  const recognize = vi
    .spyOn(OcrPluginEngine.prototype, 'recognize')
    .mockImplementation(async (_source, page) => {
      await new Promise<void>((resolve) => {
        finish.push(resolve);
      });
      return { ...page, blocks: [] };
    });
  let current = 0;
  const onPageRecognized = vi.fn();
  const { result, unmount } = renderHook(() =>
    useOcrSession({
      enabled: true,
      language: 'ja',
      onPageRecognized,
      getDocuments: () => [docs[current]!, docs[1 - current]!],
    }),
  );
  try {
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    current = 1;
    const next = result.current(docs[1]!.doc, 1);
    finish[0]!();
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    expect(onPageRecognized).not.toHaveBeenCalled();
    current = 0;
    const reversed = result.current(docs[0]!.doc, 0);
    finish[1]!();
    await vi.waitFor(() => expect(finish).toHaveLength(3));
    expect(onPageRecognized).not.toHaveBeenCalled();
    finish[2]!();
    await reversed;
    expect(onPageRecognized).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0 }));
    onPageRecognized.mockClear();
    current = 1;
    const resumed = result.current(docs[1]!.doc, 1);
    await vi.waitFor(() => expect(finish).toHaveLength(4));
    finish[3]!();
    await Promise.all([next, resumed]);
    expect(onPageRecognized).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pageIndex: 1 }),
    );
  } finally {
    finish.forEach((resolve) => resolve());
    unmount();
    recognize.mockRestore();
  }
});
