import { expect, it } from 'vitest';
import { mountOcrTextLayer } from '@/app/reader/utils/ocrTextLayer';

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
