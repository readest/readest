import { describe, it, expect, afterEach } from 'vitest';
import { classifyPdfLineBreaks, getPdfTextFromRange, type PdfLine } from '@/utils/pdfText';
import { getTextFromRange } from '@/utils/sel';

// Body text: 10px em, 12px line pitch, column spanning x 0..400.
const line = (text: string, overrides: Partial<PdfLine> = {}): PdfLine => ({
  text,
  left: 0,
  right: 400,
  top: 0,
  em: 10,
  firstWordWidth: 30,
  ...overrides,
});

describe('classifyPdfLineBreaks', () => {
  it('joins the wrapped lines of a justified paragraph with spaces', () => {
    const lines = [
      line('If you are ever creating printed output, the most', { top: 0 }),
      line('accurate way to calibrate your monitor is to print a', { top: 12 }),
      line('test image first.', { top: 24, right: 120 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space', 'space']);
  });

  it('keeps a paragraph break after a short last line when the next word would have fit', () => {
    const lines = [
      line('side by side with printed output.', { top: 0, right: 250 }),
      line('If you are creating output for video or television,', { top: 12, firstWordWidth: 15 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['paragraph']);
  });

  it('joins ragged-right lines whose next word would not have fit', () => {
    const lines = [
      line('a ragged line that stops a little', { top: 0, right: 380 }),
      line('short because the next word is wide', { top: 12, right: 395, firstWordWidth: 40 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space']);
  });

  it('keeps a paragraph break across a larger-than-usual vertical gap', () => {
    const lines = [
      line('first line of paragraph one', { top: 0 }),
      line('second line of paragraph one', { top: 12 }),
      line('first line of paragraph two', { top: 30 }),
      line('second line of paragraph two', { top: 42 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space', 'paragraph', 'space']);
  });

  it('keeps a paragraph break when the font size changes', () => {
    const lines = [
      line('Chapter Heading', { top: 0, em: 16, right: 200 }),
      line('Body text starts here and runs on', { top: 24 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['paragraph']);
  });

  it('keeps one line per centred line', () => {
    const lines = [
      line('The Title', { top: 0, left: 150, right: 250 }),
      line('by Someone', { top: 12, left: 130, right: 270 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['paragraph']);
  });

  it('continues a paragraph into the next column when the line is full', () => {
    const lines = [
      line('last line of column one is full', { top: 0 }),
      line('and continues here', { top: -300, left: 500, right: 700 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space']);
  });

  it('ignores wider lines of another font when measuring the column width', () => {
    const lines = [
      line('A full-width title over two columns', { top: 0, em: 16, right: 900 }),
      line('first column line one', { top: 30 }),
      line('first column line two', { top: 42 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['paragraph', 'space']);
  });

  it('keeps a paragraph break before an indented first line even when the last line is nearly full', () => {
    const lines = [
      line('body line at the column edge', { top: 0 }),
      line('another body line at the edge', { top: 12 }),
      line('double-space your paper. True-Type 1 fonts are preferred.', { top: 24, right: 391 }),
      line('The first paragraph in each section should not be', {
        top: 36,
        left: 16,
        firstWordWidth: 13,
      }),
      line('indented, but all following paragraphs within the', { top: 48 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space', 'space', 'paragraph', 'space']);
  });

  it('does not break before the indented continuation line of a list item', () => {
    const lines = [
      line('body text at the column edge runs long', { top: 0 }),
      line('more body text at the column edge here', { top: 12 }),
      line('and a third body line at the column edge', { top: 24 }),
      line('- a bulleted item that is long enough to wrap', { top: 36, left: 15 }),
      line('onto a second line, indented past the bullet', { top: 48, left: 25, right: 300 }),
      line('- the next bullet', { top: 60, left: 15, right: 150 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual([
      'space',
      'space',
      'paragraph',
      'space',
      'paragraph',
    ]);
  });

  it('treats hanging-indent continuation lines as line wraps', () => {
    const lines = [
      line('[1] A. Author, "A long reference title that', { top: 0 }),
      line('wraps onto a second line and then a third', { top: 12, left: 15 }),
      line('one," Journal, 2020.', { top: 24, left: 15, right: 150 }),
      line('[2] B. Author, "Another long reference that', { top: 36 }),
      line('wraps onto a second line and then a third', { top: 48, left: 15 }),
      line('one," Journal, 2021.', { top: 60, left: 15, right: 150 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space', 'space', 'paragraph', 'space', 'space']);
  });

  it('continues two runs of the same printed line', () => {
    const lines = [
      line('left cell', { top: 0, right: 100 }),
      line('right cell', { top: 0, left: 150, right: 250 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['space']);
  });

  it('drops a line-end hyphen before a lowercase continuation', () => {
    const lines = [
      line('the calibra-', { top: 0 }),
      line('tion will never', { top: 12 }),
      line('like Wi-', { top: 24 }),
      line('Fi and soft\u00AD', { top: 36 }),
      line('hyphen', { top: 48 }),
    ];
    expect(classifyPdfLineBreaks(lines)).toEqual(['dehyphenate', 'space', 'join', 'dehyphenate']);
  });

  it('joins CJK lines without a space', () => {
    const lines = [line('这是第一行文字，', { top: 0 }), line('这是第二行文字。', { top: 12 })];
    expect(classifyPdfLineBreaks(lines)).toEqual(['join']);
  });

  it('does not add a space when the seam already has one', () => {
    const lines = [line('trailing space ', { top: 0 }), line('next line', { top: 12 })];
    expect(classifyPdfLineBreaks(lines)).toEqual(['join']);
  });

  it('falls back to line breaks when there is no geometry', () => {
    const lines = [line('no layout', { em: 0 }), line('at all', { em: 0 })];
    expect(classifyPdfLineBreaks(lines)).toEqual(['paragraph']);
  });
});

describe('getPdfTextFromRange', () => {
  const mockRect = (el: Element, left: number, top: number, width: number, height: number) => {
    el.getBoundingClientRect = () =>
      ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  const span = (text: string, left: number, top: number, width: number, height = 10) => {
    const el = document.createElement('span');
    el.setAttribute('role', 'presentation');
    el.textContent = text;
    mockRect(el, left, top, width, height);
    return el;
  };
  const br = () => {
    const el = document.createElement('br');
    el.setAttribute('role', 'presentation');
    return el;
  };

  let layer: HTMLElement;
  afterEach(() => {
    layer?.remove();
  });

  const buildTwoParagraphs = () => {
    layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.append(
      span('If you are ever creating printed output, the', 0, 0, 400),
      br(),
      span('most accurate way to calibrate your monitor is', 0, 12, 400),
      br(),
      span('to print a test image.', 0, 24, 200),
      br(),
      span('If you are creating output for video, it pays to', 0, 36, 400),
      br(),
      span('view your footage.', 0, 48, 160),
      br(),
    );
    document.body.appendChild(layer);
    return layer;
  };

  it('joins wrapped lines and keeps the paragraph break inside a selection', () => {
    const layer = buildTwoParagraphs();
    const range = document.createRange();
    // From "creating" on line 1 to "footage" on the last line.
    range.setStart(layer.children[0]!.firstChild!, 16);
    range.setEnd(layer.children[8]!.firstChild!, 17);

    expect(getPdfTextFromRange(range, layer)).toBe(
      'creating printed output, the most accurate way to calibrate your monitor is to print a test image.\n' +
        'If you are creating output for video, it pays to view your footage',
    );
  });

  it('is used by getTextFromRange for pdf.js text layers', () => {
    const layer = buildTwoParagraphs();
    const range = document.createRange();
    range.selectNodeContents(layer);

    expect(getTextFromRange(range)).toBe(
      'If you are ever creating printed output, the most accurate way to calibrate your monitor is to print a test image.\n' +
        'If you are creating output for video, it pays to view your footage.',
    );
  });

  it('removes a hyphen when a word wraps', () => {
    layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.append(span('the calibra-', 0, 0, 400), br(), span('tion is done', 0, 12, 300), br());
    document.body.appendChild(layer);
    const range = document.createRange();
    range.selectNodeContents(layer);

    expect(getTextFromRange(range)).toBe('the calibration is done');
  });
});
