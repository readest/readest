import { describe, expect, test } from 'vitest';
import {
  ellipsize,
  fitTextBlock,
  getTextDirection,
  splitParagraphs,
  splitRuns,
  wrapRuns,
  wrapText,
  type MeasureText,
  type QuoteCardRun,
} from '@/utils/quoteCard';

// Every character is half its font size wide (bold a little wider):
// deterministic and script-agnostic.
const measure: MeasureText = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return Array.from(text).length * size * (font.includes(' 700 ') ? 0.6 : 0.5);
};
const font = (size: number) => `400 ${size}px serif`;
const styledFont = (size: number, style: { bold?: boolean; italic?: boolean } = {}) =>
  `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${size}px serif`;

const ACTS_8_30_31 =
  '30 And Philip ran thither to him, and heard him read the prophet Esaias, and said, ' +
  'Understandest thou what thou readest?\n' +
  '31 And he said, How can I, except some man should guide me? And he desired Philip ' +
  'that he would come up and sit with him.';

describe('splitParagraphs', () => {
  test('keeps verse breaks and collapses inner whitespace', () => {
    expect(splitParagraphs(`  ${ACTS_8_30_31.replace('him,', 'him,\t  ')}\n\n `)).toEqual([
      expect.stringMatching(/^30 And Philip ran thither to him, and heard/),
      expect.stringMatching(/^31 And he said/),
    ]);
  });
});

describe('getTextDirection', () => {
  test('detects RTL from the first strong character', () => {
    expect(getTextDirection('"שָׁלוֹם" world')).toBe('rtl');
    expect(getTextDirection('123 مرحبا')).toBe('rtl');
    expect(getTextDirection('“Hello” مرحبا')).toBe('ltr');
    expect(getTextDirection('读书')).toBe('ltr');
  });
});

describe('wrapText', () => {
  test('wraps Latin text at spaces without exceeding the width', () => {
    const lines = wrapText('Understandest thou what thou readest?', font(10), 70, measure);
    expect(lines).toEqual(['Understandest', 'thou what thou', 'readest?']);
  });

  test('wraps CJK text between characters', () => {
    const lines = wrapText('读书使人充实讨论使人机智', font(10), 25, measure);
    expect(lines).toEqual(['读书使人充', '实讨论使人', '机智']);
  });

  test('never starts a line with closing punctuation', () => {
    const lines = wrapText('读书使人充，实讨论', font(10), 25, measure);
    expect(lines[0]).toBe('读书使人充，');
    expect(lines[1]).toBe('实讨论');
  });

  test('splits a word longer than the line', () => {
    const lines = wrapText('a supercalifragilistic word', font(10), 40, measure);
    expect(lines.every((l) => measure(l, font(10)) <= 40)).toBe(true);
    expect(lines.join('').replace(/\s/g, '')).toBe('asupercalifragilisticword');
  });
});

describe('fitTextBlock', () => {
  const spec = (text: string) => ({
    paragraphs: splitRuns([{ text }]),
    width: 400,
    fontFor: font,
    minSize: 10,
    maxSize: 60,
    lineHeight: 1.5,
    paragraphGap: 0.6,
  });

  test('keeps the two verses as separate paragraphs', () => {
    const block = fitTextBlock(spec(ACTS_8_30_31), measure, { maxHeight: 600 });
    const firstOf31 = block.lines.findIndex((l) => l.text.startsWith('31'));
    expect(firstOf31).toBeGreaterThan(0);
    expect(block.lines[firstOf31]!.paragraphStart).toBe(true);
    expect(block.truncated).toBe(false);
    expect(block.height).toBeLessThanOrEqual(600);
  });

  test('picks a smaller size for longer text and keeps every line inside the width', () => {
    const short = fitTextBlock(spec('Understandest thou what thou readest?'), measure, {
      maxHeight: 600,
    });
    const long = fitTextBlock(spec(ACTS_8_30_31), measure, { maxHeight: 600 });
    expect(long.fontSize).toBeLessThan(short.fontSize);
    for (const line of long.lines) {
      // Closing punctuation may hang past the edge; the rest must fit.
      const body = line.text.replace(/[,.;:!?]+$/, '');
      expect(measure(body, font(long.fontSize))).toBeLessThanOrEqual(400);
    }
  });

  test('truncates with an ellipsis when the minimum size still overflows', () => {
    const block = fitTextBlock(spec(ACTS_8_30_31.repeat(20)), measure, { maxHeight: 120 });
    expect(block.fontSize).toBe(10);
    expect(block.truncated).toBe(true);
    expect(block.lines.at(-1)!.text.endsWith('…')).toBe(true);
    expect(block.height).toBeLessThanOrEqual(120);
  });

  test('grows up to overflowHeight before truncating', () => {
    const text = ACTS_8_30_31.repeat(3);
    const grown = fitTextBlock(spec(text), measure, { maxHeight: 120, overflowHeight: 5000 });
    expect(grown.truncated).toBe(false);
    expect(grown.fontSize).toBe(10);
    expect(grown.height).toBeGreaterThan(120);
    const capped = fitTextBlock(spec(text.repeat(40)), measure, {
      maxHeight: 120,
      overflowHeight: 600,
    });
    expect(capped.truncated).toBe(true);
    expect(capped.height).toBeLessThanOrEqual(600);
  });
});

describe('ellipsize', () => {
  test('returns short text unchanged and shortens long text to fit', () => {
    expect(ellipsize('Acts', font(10), 100, measure)).toBe('Acts');
    const out = ellipsize('The Holy Bible (KJV), Holy Spirit Edition', font(10), 60, measure);
    expect(out.endsWith('…')).toBe(true);
    expect(measure(out, font(10))).toBeLessThanOrEqual(60);
  });
});

const VERSE: QuoteCardRun[] = [
  { text: '30', bold: true },
  { text: ' And Philip ran thither to ' },
  { text: 'him', italic: true },
  { text: ' , and heard him\n' },
  { text: '31', bold: true },
  { text: '  And he said' },
];

describe('splitRuns', () => {
  test('splits styled runs into paragraphs and collapses whitespace across runs', () => {
    expect(splitRuns(VERSE)).toEqual([
      [
        { text: '30', bold: true },
        { text: ' And Philip ran thither to ' },
        { text: 'him', italic: true },
        { text: ' , and heard him' },
      ],
      [{ text: '31', bold: true }, { text: ' And he said' }],
    ]);
  });
});

describe('wrapRuns', () => {
  test('keeps each piece in its own font and fits the measured line width', () => {
    const [first] = splitRuns(VERSE);
    const lines = wrapRuns(first!, (style) => styledFont(10, style), 100, measure);
    expect(lines[0]![0]).toEqual({ text: '30', font: '700 10px serif' });
    const pieces = lines.flat();
    expect(pieces.find((p) => p.text.includes('him') && p.font.startsWith('italic'))?.text).toBe(
      'him',
    );
    for (const line of lines) {
      const width = line.reduce((sum, p) => sum + measure(p.text, p.font), 0);
      expect(width).toBeLessThanOrEqual(100 + 5);
    }
    expect(
      pieces
        .map((p) => p.text)
        .join(' ')
        .replace(/\s+/g, ' '),
    ).toContain('thither to');
  });

  test('fitTextBlock lays out positioned pieces for styled lines', () => {
    const block = fitTextBlock(
      {
        paragraphs: splitRuns(VERSE),
        width: 400,
        fontFor: styledFont,
        minSize: 10,
        maxSize: 40,
        lineHeight: 1.5,
        paragraphGap: 0.6,
      },
      measure,
      { maxHeight: 400 },
    );
    const line = block.lines[0]!;
    expect(line.pieces[0]).toMatchObject({ text: '30', x: 0 });
    expect(line.pieces[1]!.x).toBe(measure('30', line.pieces[0]!.font));
    expect(line.text.startsWith('30 And Philip')).toBe(true);
    expect(line.width).toBe(line.pieces.reduce((sum, p) => sum + measure(p.text, p.font), 0));
  });
});
