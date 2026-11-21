import { describe, expect, test } from 'vitest';
import type { Book } from '@/types/book';
import { getFallbackCoverColor, renderFallbackCover } from '@/utils/cover';

const decode = async (bytes: ArrayBuffer) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

const hex = (data: Uint8ClampedArray, i: number) =>
  `#${[data[i], data[i + 1], data[i + 2]].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;

// Count pixels in a band of rows that differ from the background color.
const inkInRows = (image: ImageData, from: number, to: number, background: string) => {
  let ink = 0;
  for (let y = from; y < to; y++) {
    for (let x = image.width * 0.14; x < image.width * 0.9; x++) {
      if (hex(image.data, (y * image.width + Math.floor(x)) * 4) !== background) ink++;
    }
  }
  return ink;
};

describe('renderFallbackCover', () => {
  test('draws the title and author on the book color', async () => {
    const book = {
      hash: 'b1d2c3',
      title: 'A Book Without Cover',
      author: 'Jane Doe',
      format: 'TXT',
    } as Book;
    const image = await decode(await renderFallbackCover(book));
    const background = getFallbackCoverColor(book.hash);

    expect([image.width, image.height]).toEqual([1200, 1600]);
    expect(hex(image.data, 0)).toBe(background);
    // Title in the middle of the cover, author near the bottom, blank top.
    expect(inkInRows(image, 650, 950, background)).toBeGreaterThan(1000);
    expect(inkInRows(image, 1360, 1480, background)).toBeGreaterThan(500);
    expect(inkInRows(image, 0, 110, background)).toBe(0);
  });

  test('each block is drawn in its own text direction', async () => {
    const drawn: { text: string; direction: string }[] = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      drawn.push({ text, direction: this.direction });
      return fillText.call(this, text, ...rest);
    };
    try {
      await renderFallbackCover({
        hash: 'he',
        title: 'שלום!',
        author: 'Jane Doe',
        format: 'TXT',
      } as Book);
    } finally {
      CanvasRenderingContext2D.prototype.fillText = fillText;
    }

    expect(drawn).toEqual([
      { text: 'Jane Doe', direction: 'ltr' },
      { text: 'שלום!', direction: 'rtl' },
    ]);
  });

  test('a book without an author still gets a centered title', async () => {
    const book = { hash: 'x', title: '三体', author: '', format: 'TXT' } as Book;
    const image = await decode(await renderFallbackCover(book));
    const background = getFallbackCoverColor(book.hash);

    expect(inkInRows(image, 740, 860, background)).toBeGreaterThan(500);
    expect(inkInRows(image, 1300, 1600, background)).toBe(0);
  });
});
