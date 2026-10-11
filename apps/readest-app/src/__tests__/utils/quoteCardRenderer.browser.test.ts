import { describe, expect, test } from 'vitest';
import {
  QUOTE_CARD_COLORS,
  QUOTE_CARD_FONTS,
  QUOTE_CARD_SIZES,
  type QuoteCardLayoutId,
} from '@/utils/quoteCard';
import { quoteCardToPng, renderQuoteCard } from '@/utils/quoteCardRenderer';

const ACTS_8_30_31 =
  '30 And Philip ran thither to him, and heard him read the prophet Esaias, and said, ' +
  'Understandest thou what thou readest?\n' +
  '31 And he said, How can I, except some man should guide me? And he desired Philip ' +
  'that he would come up and sit with him.';

const content = {
  text: ACTS_8_30_31,
  title: 'The Holy Bible (KJV)',
  author: 'King James',
  chapter: 'Acts Of The Apostles',
  date: 'Oct 10, 2026',
};

const redCover = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 300;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, 200, 300);
  return canvas.toDataURL('image/png');
};

const pixels = (canvas: HTMLCanvasElement) =>
  canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;

const countColors = (data: Uint8ClampedArray) => {
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4 * 97) {
    seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  }
  return seen.size;
};

const countRed = (data: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 240 && data[i + 1]! < 20 && data[i + 2]! < 20) n++;
  }
  return n;
};

describe('renderQuoteCard (browser)', () => {
  for (const layout of ['classic', 'centered', 'cover', 'page'] as QuoteCardLayoutId[]) {
    test(`${layout} paints a portrait card with text on it`, async () => {
      const canvas = document.createElement('canvas');
      const { truncated } = await renderQuoteCard(canvas, content, {
        layout,
        colors: QUOTE_CARD_COLORS.paper,
        fontFamily: QUOTE_CARD_FONTS.serif,
        shape: 'portrait',
        showBookInfo: true,
        showQr: false,
      });
      expect(truncated).toBe(false);
      expect(canvas.width).toBe(QUOTE_CARD_SIZES.portrait.width);
      expect(canvas.height).toBe(QUOTE_CARD_SIZES.portrait.height);
      expect(countColors(pixels(canvas))).toBeGreaterThan(4);
    });
  }

  test('draws the cover when it loads and skips one that fails', async () => {
    const style = {
      layout: 'cover' as const,
      colors: QUOTE_CARD_COLORS.night,
      fontFamily: QUOTE_CARD_FONTS.sans,
      shape: 'fit' as const,
      showBookInfo: true,
      showQr: false,
    };
    const withCover = document.createElement('canvas');
    await renderQuoteCard(withCover, { ...content, coverUrl: redCover() }, style);
    expect(countRed(pixels(withCover))).toBeGreaterThan(1000);

    const broken = document.createElement('canvas');
    await renderQuoteCard(broken, { ...content, coverUrl: 'data:image/png;base64,AAAA' }, style);
    expect(countRed(pixels(broken))).toBe(0);
    expect(broken.width).toBe(QUOTE_CARD_SIZES.fit.width);
  });

  test('paints the QR code in the card colors when asked', async () => {
    const style = {
      layout: 'classic' as const,
      colors: QUOTE_CARD_COLORS.night,
      fontFamily: QUOTE_CARD_FONTS.serif,
      shape: 'fit' as const,
      showBookInfo: true,
    };
    const qrUrl = 'https://web.readest.com/o/book/abc/annotation/def?cfi=epubcfi(%2F6%2F4)';
    // Night's foreground is #e9dfc8; nothing on the card is pure white or black.
    const count = (data: Uint8ClampedArray, [r, g, b]: number[]) => {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === r && data[i + 1] === g && data[i + 2] === b) n++;
      }
      return n;
    };
    const off = document.createElement('canvas');
    await renderQuoteCard(off, { ...content, qrUrl }, { ...style, showQr: false });
    const on = document.createElement('canvas');
    await renderQuoteCard(on, { ...content, qrUrl }, { ...style, showQr: true });
    const fg = [0xe9, 0xdf, 0xc8];
    expect(count(pixels(on), fg) - count(pixels(off), fg)).toBeGreaterThan(3000);
    expect(count(pixels(on), [0, 0, 0])).toBe(0);
    expect(count(pixels(on), [255, 255, 255])).toBe(0);
  });

  test('exports a PNG blob', async () => {
    const canvas = document.createElement('canvas');
    await renderQuoteCard(canvas, content, {
      layout: 'classic',
      colors: QUOTE_CARD_COLORS.sepia,
      fontFamily: QUOTE_CARD_FONTS.serif,
      shape: 'square',
      showBookInfo: false,
      showQr: false,
    });
    const blob = await quoteCardToPng(canvas);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(1000);
  });
});
