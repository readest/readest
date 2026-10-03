import { expect, it, vi } from 'vitest';
import { mountOcrTextLayer } from '@/app/reader/utils/ocrTextLayer';
import { TesseractOcrEngine, type TesseractWorker } from '@/plugins/ocr/tesseractEngine';
import { getTesseractLanguages } from '@/plugins/ocr/tesseractLanguages';

it('fits recognised lines inside their box when the detected font is too large', () => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1000px;height:1000px;border:0';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.body.style.cssText = 'margin:0;position:relative;width:1000px;height:1000px';
    for (const vertical of [true, false]) {
      const layer = mountOcrTextLayer(doc, {
        pageIndex: 0,
        width: 1000,
        height: 1000,
        language: 'ja',
        blocks: [
          {
            id: 'dialogue',
            text: 'ホントだな！？',
            lines: ['ホント', 'だな！？'],
            fontSize: 33,
            box: { xMin: 0, yMin: 0, xMax: vertical ? 73 : 97, yMax: vertical ? 97 : 73 },
            writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
          },
        ],
      });
      const block = layer!.firstElementChild as HTMLElement;
      expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth + 1);
      expect(block.scrollHeight).toBeLessThanOrEqual(block.clientHeight + 1);
      expect(block.textContent).toBe('ホントだな！？');
    }
  } finally {
    frame.remove();
  }
});

it('preserves word boundaries from manga recognition through native text selection', async () => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1000px;height:1000px;border:0';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.body.style.cssText = 'margin:0;position:relative;width:1000px;height:1000px';
    const source = doc.createElement('canvas');
    source.width = source.height = 1000;
    const page = { pageIndex: 0, width: 1000, height: 1000 };
    for (const [language, lines, separator] of [
      ['en', ['uninterrupted hello', 'world'], ' '],
      ['ko-KR', ['안녕하세요', '반갑습니다'], ' '],
      ['jpn', ['一行目', '二行目'], ''],
      ['zh-TW', ['你好', '世界'], ''],
    ] as const) {
      let index = 0;
      const recognize = vi.fn(async () => ({
        text: lines[index++] ?? 'unexpected crop',
        confidence: 95,
      }));
      const worker: TesseractWorker = {
        setParameters: async () => undefined,
        recognize: async () => ({ data: await recognize() }),
        terminate: async () => undefined,
      };
      const width = language === 'jpn' ? 300 : 900;
      const engine = new TesseractOcrEngine(
        { mangaMode: true, textLanguage: language, languages: getTesseractLanguages(language) },
        async () => worker,
        () => ({
          detect: async () => ({
            page,
            blocks: [
              {
                box: { xMin: 0, yMin: 0, xMax: width, yMax: 100 },
                score: 1,
                language: 'ja',
                vertical: false,
                lines: [0, 50].map((y) => ({
                  box: { xMin: 0, yMin: y, xMax: width, yMax: y + 40 },
                  polygon: [
                    { x: 0, y },
                    { x: width, y },
                    { x: width, y: y + 40 },
                    { x: 0, y: y + 40 },
                  ],
                  score: 1,
                  vertical: false,
                })),
              },
            ],
          }),
          terminate: async () => undefined,
        }),
        undefined,
        async () => new ArrayBuffer(1),
        () => ({ recognize, terminate: async () => undefined }),
      );
      try {
        const result = await engine.recognize(source, page);
        const expected = lines.join(separator);
        expect(result.blocks[0]?.text).toBe(expected);
        expect(recognize).toHaveBeenCalledTimes(2);
        const layer = mountOcrTextLayer(doc, result)!;
        const block = layer.firstElementChild as HTMLElement;
        block.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(doc.getSelection()!.toString()).toBe(expected);
        expect(block.scrollHeight).toBeLessThanOrEqual(block.clientHeight + 1);
        doc.getSelection()!.removeAllRanges();
      } finally {
        await engine.terminate();
      }
    }
  } finally {
    frame.remove();
  }
});

it('keeps a selected OCR block visible while its popup is open', async () => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1000px;height:1000px;border:0';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.body.style.cssText = 'margin:0;position:relative;width:1000px;height:1000px';
    const layer = mountOcrTextLayer(doc, {
      pageIndex: 0,
      width: 1000,
      height: 1000,
      blocks: [
        {
          id: 'dialogue',
          text: '日本語',
          box: { xMin: 100, yMin: 100, xMax: 300, yMax: 300 },
          writingMode: 'horizontal-tb',
        },
      ],
    });
    const block = layer!.firstElementChild as HTMLElement;
    const selection = doc.getSelection()!;
    const range = doc.createRange();
    range.selectNodeContents(block);
    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(block).toHaveAttribute('data-readest-ocr-selected', '');
    expect(doc.defaultView!.getComputedStyle(block).color).toBe('rgb(0, 0, 0)');
    expect(doc.defaultView!.getComputedStyle(block).backgroundColor).toBe('rgb(255, 255, 255)');

    selection.removeAllRanges();
    doc.dispatchEvent(new Event('selectionchange'));
    expect(block).not.toHaveAttribute('data-readest-ocr-selected');
  } finally {
    frame.remove();
  }
});
