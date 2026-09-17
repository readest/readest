import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOcrSession } from '@/app/reader/hooks/useOcrSession';
import { TesseractOcrEngine } from '@/app/reader/services/ocr/tesseractEngine';

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
    .spyOn(TesseractOcrEngine.prototype, 'recognize')
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
    await result.current(docs[0]!.doc, 0);
    expect(onPageRecognized).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0 }));
    onPageRecognized.mockClear();
    current = 1;
    const resumed = result.current(docs[1]!.doc, 1);
    finish[1]!();
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
