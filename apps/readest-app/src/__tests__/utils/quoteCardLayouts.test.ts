import { describe, expect, test } from 'vitest';
import {
  QUOTE_CARD_FONTS,
  QUOTE_CARD_SIZES,
  type MeasureText,
  type QuoteCardElement,
  type QuoteCardInput,
  type QuoteCardLayoutId,
  type QuoteCardShape,
} from '@/utils/quoteCard';
import { QUOTE_CARD_LAYOUTS } from '@/utils/quoteCardLayouts';

const measure: MeasureText = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return Array.from(text).length * size * 0.5;
};

const ACTS_8_30_31 =
  '30 And Philip ran thither to him, and heard him read the prophet Esaias, and said, ' +
  'Understandest thou what thou readest?\n' +
  '31 And he said, How can I, except some man should guide me? And he desired Philip ' +
  'that he would come up and sit with him.';

const input = (overrides: Partial<QuoteCardInput> = {}): QuoteCardInput => ({
  text: ACTS_8_30_31,
  title: 'The Holy Bible (KJV)',
  author: 'King James',
  chapter: 'Acts Of The Apostles',
  date: 'Oct 10, 2026',
  showBookInfo: true,
  coverAspect: 2 / 3,
  shape: 'portrait',
  fontFamily: QUOTE_CARD_FONTS.serif,
  ...overrides,
});

const QR_URL =
  'https://web.readest.com/o/book/75abe2d2e1c5116273d2116b6266114a/annotation/abc123?cfi=epubcfi(%2F6%2F248!%2F4%2F2%2C%2F1%3A0%2C%2F3%3A45)';

const LAYOUTS = Object.keys(QUOTE_CARD_LAYOUTS) as QuoteCardLayoutId[];
const SHAPES = Object.keys(QUOTE_CARD_SIZES) as QuoteCardShape[];
const texts = (elements: QuoteCardElement[]) =>
  elements.flatMap((e) => (e.type === 'text' ? [e.text] : []));
// A trailing closing mark may hang one glyph into the padding.
const HANG = 40;

describe('quote card layouts', () => {
  test('ships the four layouts', () => {
    expect(LAYOUTS).toEqual(['classic', 'centered', 'cover', 'page']);
  });

  for (const id of LAYOUTS) {
    for (const shape of SHAPES) {
      for (const qrUrl of [undefined, QR_URL]) {
        test(`${id} / ${shape}${qrUrl ? ' / QR' : ''} keeps every element inside the card`, () => {
          const layout = QUOTE_CARD_LAYOUTS[id](input({ shape, qrUrl }), measure);
          const size = QUOTE_CARD_SIZES[shape];
          expect(layout.width).toBe(size.width);
          if (shape !== 'fit') expect(layout.height).toBe(size.height);
          for (const el of layout.elements) {
            if (el.type === 'text') {
              const w = measure(el.text, el.font);
              const left =
                el.align === 'left' ? el.x : el.align === 'right' ? el.x - w : el.x - w / 2;
              expect(left).toBeGreaterThanOrEqual(-HANG);
              expect(left + w).toBeLessThanOrEqual(layout.width + HANG);
              expect(el.y).toBeGreaterThan(0);
              expect(el.y).toBeLessThan(layout.height);
            } else {
              expect(el.x).toBeGreaterThanOrEqual(0);
              expect(el.y).toBeGreaterThanOrEqual(0);
              expect(el.x + el.w).toBeLessThanOrEqual(layout.width);
              expect(el.y + el.h).toBeLessThanOrEqual(layout.height);
            }
          }
          // The signature comes only with the QR code.
          expect(texts(layout.elements).includes('Readest')).toBe(!!qrUrl);
          expect(layout.elements.some((e) => e.type === 'image' && e.image !== 'cover')).toBe(
            false,
          );
          expect(texts(layout.elements).join(' ')).toContain('Understandest thou what thou');
          const qr = layout.elements.filter((e) => e.type === 'qr');
          expect(qr).toEqual(qrUrl ? [expect.objectContaining({ value: qrUrl })] : []);
        });
      }
    }
  }

  test('signs every layout with the given label alongside the QR code only', () => {
    for (const id of LAYOUTS) {
      const withQr = QUOTE_CARD_LAYOUTS[id](
        input({ brand: 'via Readest', qrUrl: QR_URL }),
        measure,
      );
      expect(texts(withQr.elements)).toContain('via Readest');
      const withoutQr = QUOTE_CARD_LAYOUTS[id](input({ brand: 'via Readest' }), measure);
      expect(texts(withoutQr.elements).join(' ')).not.toContain('Readest');
    }
  });

  test('a card without a QR code gives the room to the quote', () => {
    const quoteSize = (layout: ReturnType<(typeof QUOTE_CARD_LAYOUTS)['classic']>) => {
      const first = layout.elements.find((e) => e.type === 'text' && e.text.startsWith('30'));
      return Number(/(\d+)px/.exec(first?.type === 'text' ? first.font : '')?.[1]);
    };
    for (const id of ['centered', 'cover', 'page'] as const) {
      // Long enough that the room, not the maximum size, decides the size.
      const long = { shape: 'portrait' as const, text: `${ACTS_8_30_31}\n${ACTS_8_30_31}` };
      const plain = QUOTE_CARD_LAYOUTS[id](input(long), measure);
      const withQr = QUOTE_CARD_LAYOUTS[id](input({ ...long, qrUrl: QR_URL }), measure);
      expect(quoteSize(plain)).toBeGreaterThan(quoteSize(withQr));
    }
  });

  test('signs the card "Readest" in the chapter and date style', () => {
    const layout = QUOTE_CARD_LAYOUTS.classic(input({ qrUrl: QR_URL }), measure);
    const textEls = layout.elements.filter(
      (e): e is Extract<QuoteCardElement, { type: 'text' }> => e.type === 'text',
    );
    const mark = textEls.find((e) => e.text === 'Readest')!;
    const meta = textEls.find((e) => e.text.startsWith('Acts Of The Apostles'))!;
    expect(mark.color).toBe(meta.color);
    expect(mark.alpha ?? 1).toBe(meta.alpha ?? 1);
    expect(mark.font).toBe(meta.font);
  });

  test('classic puts the wordmark at the end of the last book-info line', () => {
    const layout = QUOTE_CARD_LAYOUTS.classic(input({ qrUrl: QR_URL }), measure);
    const textEls = layout.elements.filter(
      (e): e is Extract<QuoteCardElement, { type: 'text' }> => e.type === 'text',
    );
    const mark = textEls.find((e) => e.text === 'Readest')!;
    const meta = textEls.find((e) => e.text.startsWith('Acts Of The Apostles'))!;
    expect(mark.y).toBe(meta.y);
    expect(mark.align).toBe('right');
    expect(meta.x + measure(meta.text, meta.font)).toBeLessThan(
      mark.x - measure(mark.text, mark.font),
    );
  });

  test('treats book fields made only of invisible characters as missing', () => {
    const blank = QUOTE_CARD_LAYOUTS.classic(input({ author: '\u200b' }), measure);
    const none = QUOTE_CARD_LAYOUTS.classic(input({ author: undefined }), measure);
    expect(blank).toEqual(none);
  });

  test('classic centers the footer between the rule and the bottom edge', () => {
    for (const qrUrl of [undefined, QR_URL]) {
      const layout = QUOTE_CARD_LAYOUTS.classic(input({ shape: 'fit', qrUrl }), measure);
      const rule = layout.elements.find((e) => e.type === 'rect')!;
      const cover = layout.elements.find((e) => e.type === 'image')!;
      if (rule.type !== 'rect' || cover.type !== 'image') throw new Error('missing rule or cover');
      const above = cover.y - (rule.y + rule.h);
      const below = layout.height - (cover.y + cover.h);
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
    }
  });

  test('classic sizes the QR code like the cover, with the wordmark beside it', () => {
    const layout = QUOTE_CARD_LAYOUTS.classic(input({ qrUrl: QR_URL }), measure);
    const qr = layout.elements.find((e) => e.type === 'qr')!;
    const cover = layout.elements.find((e) => e.type === 'image')!;
    const textEls = layout.elements.filter(
      (e): e is Extract<QuoteCardElement, { type: 'text' }> => e.type === 'text',
    );
    const mark = textEls.find((e) => e.text === 'Readest')!;
    const meta = textEls.find((e) => e.text.startsWith('Acts Of The Apostles'))!;
    if (qr.type !== 'qr' || cover.type !== 'image') throw new Error('missing qr or cover');
    expect(qr.x + qr.w).toBe(layout.width - 96);
    expect(qr.h).toBe(cover.h);
    expect(qr.y).toBe(cover.y);
    expect(mark.y).toBe(meta.y);
    expect(mark.x).toBeLessThan(qr.x);
    // Footer text level with the QR code ends before it.
    for (const el of textEls) {
      if (el.y > qr.y && el.y < qr.y + qr.h) {
        const right = el.align === 'right' ? el.x : el.x + measure(el.text, el.font);
        expect(right).toBeLessThan(qr.x);
      }
    }
  });

  test('fit grows with the quote and truncates past its cap', () => {
    const short = QUOTE_CARD_LAYOUTS.classic(input({ shape: 'fit', text: 'Readest' }), measure);
    const long = QUOTE_CARD_LAYOUTS.classic(
      input({ shape: 'fit', text: `${ACTS_8_30_31}\n`.repeat(12) }),
      measure,
    );
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.truncated).toBe(false);
    const huge = QUOTE_CARD_LAYOUTS.classic(
      input({ shape: 'fit', text: `${ACTS_8_30_31}\n`.repeat(200) }),
      measure,
    );
    expect(huge.truncated).toBe(true);
    expect(huge.height).toBeLessThanOrEqual(QUOTE_CARD_SIZES.fit.maxHeight!);
  });

  test('fixed shapes truncate a quote that cannot fit', () => {
    const layout = QUOTE_CARD_LAYOUTS.centered(
      input({ shape: 'wide', text: ACTS_8_30_31.repeat(30) }),
      measure,
    );
    expect(layout.truncated).toBe(true);
    expect(texts(layout.elements).some((t) => t.endsWith('…'))).toBe(true);
  });

  test('cover falls back to classic without a cover', () => {
    const noCover = input({ coverAspect: undefined });
    expect(QUOTE_CARD_LAYOUTS.cover(noCover, measure)).toEqual(
      QUOTE_CARD_LAYOUTS.classic(noCover, measure),
    );
  });

  test('classic and cover draw the cover only with book info on', () => {
    for (const id of ['classic', 'cover'] as const) {
      const on = QUOTE_CARD_LAYOUTS[id](input(), measure);
      expect(on.elements.some((e) => e.type === 'image' && e.image === 'cover')).toBe(true);
      const off = QUOTE_CARD_LAYOUTS[id](input({ showBookInfo: false }), measure);
      expect(off.elements.some((e) => e.type === 'image' && e.image === 'cover')).toBe(false);
    }
  });

  test('book info off drops title, author, chapter and date', () => {
    for (const id of LAYOUTS) {
      const all = texts(QUOTE_CARD_LAYOUTS[id](input({ showBookInfo: false }), measure).elements);
      const joined = all.join(' ');
      expect(joined).not.toContain('Holy Bible');
      expect(joined).not.toContain('King James');
      expect(joined).not.toContain('Apostles');
      expect(joined).not.toContain('2026');
    }
  });

  test('page highlights every quote line', () => {
    const layout = QUOTE_CARD_LAYOUTS.page(input(), measure);
    const highlights = layout.elements.filter(
      (e) => e.type === 'rect' && e.color === 'accent' && (e.alpha ?? 1) < 1 && e.h > 20,
    );
    const quoteLines = layout.elements.filter(
      (e) => e.type === 'text' && /^(30|31)|Esaias|Philip|readest|guide|sit with/.test(e.text),
    );
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.length).toBeGreaterThanOrEqual(quoteLines.length);
  });

  test('sets the quote in the given font family', () => {
    const family = '"My Book Font", serif';
    const layout = QUOTE_CARD_LAYOUTS.classic(input({ fontFamily: family }), measure);
    const quote = layout.elements.find((e) => e.type === 'text' && e.text.startsWith('30'));
    expect(quote?.type === 'text' && quote.font.endsWith(family)).toBe(true);
  });

  test('RTL quotes mirror to the right edge', () => {
    const layout = QUOTE_CARD_LAYOUTS.classic(
      input({ text: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ' }),
      measure,
    );
    const quote = layout.elements.find(
      (e): e is Extract<QuoteCardElement, { type: 'text' }> =>
        e.type === 'text' && e.text.includes('בְּרֵאשִׁית'),
    )!;
    expect(quote.dir).toBe('rtl');
    expect(quote.align).toBe('right');
    expect(quote.x).toBeGreaterThan(layout.width / 2);
  });

  test('draws bold and italic runs in their own fonts', () => {
    const layout = QUOTE_CARD_LAYOUTS.classic(
      input({
        text: '30 And Philip ran thither to him , and heard',
        runs: [
          { text: '30', bold: true },
          { text: ' And Philip ran thither to ' },
          { text: 'him', italic: true },
          { text: ' , and heard' },
        ],
      }),
      measure,
    );
    const textEls = layout.elements.filter(
      (e): e is Extract<QuoteCardElement, { type: 'text' }> => e.type === 'text',
    );
    expect(textEls.find((e) => e.text === '30')?.font).toMatch(/^700 /);
    expect(textEls.find((e) => e.text === 'him')?.font).toMatch(/^italic 400 /);
  });
});
