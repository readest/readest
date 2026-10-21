// The quote card layouts (#5830). Each one is a pure function from the card
// input to absolutely positioned elements, laid out left-to-right and mirrored
// for RTL quotes at the end. Adding a layout means adding one function here.
import {
  QUOTE_CARD_SIZES,
  ellipsize,
  fitTextBlock,
  getTextDirection,
  splitRuns,
  type MeasureText,
  type QuoteCardColorRole,
  type QuoteCardElement,
  type QuoteCardInput,
  type QuoteCardLayout,
  type QuoteCardLayoutId,
  type TextBlock,
} from './quoteCard';

type LayoutFn = (input: QuoteCardInput, measure: MeasureText) => QuoteCardLayout;

// Brand mark, never translated.
const LOGO_TEXT = 'Readest';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createFrame = (input: QuoteCardInput, measure: MeasureText) => {
  const size = QUOTE_CARD_SIZES[input.shape];
  const s = Math.min(size.width, size.height) / 1080;
  const family = input.fontFamily;
  // Metadata can hold only invisible characters (a lone zero-width space);
  // those fields count as missing rather than leaving a blank line.
  const clean = (value?: string) => value?.replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
  const info = input.showBookInfo
    ? {
        title: clean(input.title),
        author: clean(input.author),
        chapter: clean(input.chapter),
        date: input.date,
      }
    : {};
  return {
    input,
    measure,
    size,
    isFit: size.maxHeight !== undefined,
    s,
    W: size.width,
    P: Math.round(96 * s),
    dir: getTextDirection(input.text),
    info,
    font: (px: number, weight = 400, italic = false) =>
      `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${family}`,
  };
};
type Frame = ReturnType<typeof createFrame>;

// Fits the quote into what the chrome leaves: the fixed height, or for Fit the
// target height (for sizing) and the cap (for truncation).
const fitQuote = (
  fr: Frame,
  width: number,
  chrome: number,
  { min, max, lineHeight = 1.55 }: { min: number; max: number; lineHeight?: number },
): TextBlock =>
  fitTextBlock(
    {
      paragraphs: splitRuns(fr.input.runs ?? [{ text: fr.input.text }]),
      width,
      fontFor: (px, style) => fr.font(px, style?.bold ? 700 : 400, style?.italic),
      minSize: Math.round(min * fr.s),
      maxSize: Math.round(max * fr.s),
      lineHeight,
      paragraphGap: 0.6,
    },
    fr.measure,
    {
      maxHeight: fr.size.height - chrome,
      overflowHeight: fr.size.maxHeight ? fr.size.maxHeight - chrome : undefined,
    },
  );

const text = (
  fr: Frame,
  value: string,
  x: number,
  y: number,
  font: string,
  align: 'left' | 'right' | 'center' = 'left',
  color: QuoteCardColorRole = 'fg',
  alpha?: number,
): QuoteCardElement => ({
  type: 'text',
  text: value,
  x,
  y,
  font,
  color,
  align,
  dir: fr.dir,
  alpha,
});

// One text element per styled piece, placed left to right (mirrored for RTL).
const quoteLines = (
  fr: Frame,
  block: TextBlock,
  x: number,
  top: number,
  width: number,
  align: 'left' | 'center',
) =>
  block.lines.flatMap((line) => {
    const start = align === 'center' ? x + (width - line.width) / 2 : x;
    return line.pieces.map((piece) =>
      text(fr, piece.text, start + piece.x, top + line.y, piece.font, 'left'),
    );
  });

interface Row {
  text: string;
  font: string;
  h: number;
  color?: QuoteCardColorRole;
  alpha?: number;
}

const rowsHeight = (rows: Row[]) => rows.reduce((sum, row) => sum + row.h, 0);

const drawRows = (
  fr: Frame,
  rows: Row[],
  x: number,
  top: number,
  width: number,
  align: 'left' | 'center',
) => {
  let y = top;
  return rows.map((row) => {
    const value = ellipsize(row.text, row.font, width, fr.measure);
    const el = text(fr, value, align === 'center' ? x + width / 2 : x, y + row.h / 2, row.font);
    y += row.h;
    return { ...el, align, color: row.color ?? 'fg', alpha: row.alpha } as QuoteCardElement;
  });
};

// The signature that accompanies the QR code (an app icon would be too small
// to read at card scale).
const wordmark = (fr: Frame) => {
  // Set like the chapter and date line it ends.
  const font = fr.font(24 * fr.s);
  const label = fr.input.brand ?? LOGO_TEXT;
  const at = (x: number, y: number, align: 'left' | 'right' | 'center'): QuoteCardElement => ({
    type: 'text',
    text: label,
    x,
    y,
    font,
    color: 'accent',
    align,
    dir: 'ltr',
  });
  return { width: fr.measure(label, font), height: 36 * fr.s, at };
};

// QR codes are as tall as the Classic footer's cover thumbnail.
const QR_SIZE = 150;

// The brand block: the passage QR code captioned with the signature. A card
// without a QR code carries no branding and reserves no room for it. `place`
// positions it by its top edge and horizontal anchor.
const brand = (fr: Frame) => {
  const word = wordmark(fr);
  const qr = fr.input.qrUrl ? QR_SIZE * fr.s : 0;
  const gap = 12 * fr.s;
  const width = qr ? Math.max(qr, word.width) : 0;
  const height = qr ? qr + gap + word.height : 0;
  const place = (x: number, top: number, align: 'left' | 'right' | 'center') => {
    if (!fr.input.qrUrl) return [];
    const cx = align === 'left' ? x + width / 2 : align === 'right' ? x - width / 2 : x;
    return [
      { type: 'qr', value: fr.input.qrUrl, x: cx - qr / 2, y: top, w: qr, h: qr },
      word.at(cx, top + qr + gap + word.height / 2, 'center'),
    ] as QuoteCardElement[];
  };
  return { width, height, place };
};

const mirror = (width: number, el: QuoteCardElement): QuoteCardElement => {
  if (el.type !== 'text') return { ...el, x: width - el.x - el.w };
  const align = el.align === 'left' ? 'right' : el.align === 'right' ? 'left' : 'center';
  return { ...el, x: width - el.x, align };
};

const finish = (
  fr: Frame,
  elements: QuoteCardElement[],
  height: number,
  block: TextBlock,
): QuoteCardLayout => ({
  width: fr.W,
  height: Math.round(height),
  elements: fr.dir === 'rtl' ? elements.map((el) => mirror(fr.W, el)) : elements,
  truncated: block.truncated,
});

const classic: LayoutFn = (input, measure) => {
  const fr = createFrame(input, measure);
  const { s, P, W, info } = fr;
  const contentW = W - 2 * P;
  const markH = 110 * s;
  const quoteTop = P + markH + 10 * s;
  const word = wordmark(fr);

  const rows: Row[] = [];
  if (info.title) rows.push({ text: info.title, font: fr.font(34 * s, 600), h: 48 * s });
  if (info.author) rows.push({ text: info.author, font: fr.font(28 * s), h: 40 * s, alpha: 0.8 });
  const meta = [info.chapter, info.date].filter(Boolean).join(' · ');
  if (meta) rows.push({ text: meta, font: fr.font(24 * s), h: 36 * s, color: 'accent' });
  const coverH = input.showBookInfo && input.coverAspect ? 150 * s : 0;
  const coverW = coverH ? coverH * clamp(input.coverAspect!, 0.5, 1) : 0;
  const qrSize = input.qrUrl ? QR_SIZE * s : 0;
  const hasInfo = rows.length > 0 || coverH > 0;
  // The footer ends the card, centered between the rule and the bottom edge:
  // cover and book info, then (with the QR code) the signature on the last
  // line and the QR code at the end.
  const footerH = Math.max(coverH, rowsHeight(rows), qrSize);
  const gap = 64 * s;
  const footerBlock = hasInfo
    ? 48 * s + 2 * s + gap + footerH + gap
    : qrSize
      ? 48 * s + footerH + P
      : P;

  const chrome = quoteTop + footerBlock;
  const block = fitQuote(fr, contentW, chrome, { min: 28, max: 64 });
  const H = fr.isFit ? chrome + block.height : fr.size.height;

  const elements: QuoteCardElement[] = [
    text(fr, '“', P - 6 * s, P + markH / 2, fr.font(160 * s, 700), 'left', 'accent'),
    ...quoteLines(fr, block, P, quoteTop, contentW, 'left'),
  ];
  const footerTop = H - (hasInfo ? gap : P) - footerH;
  const middle = footerTop + footerH / 2;
  if (hasInfo) {
    elements.push({
      type: 'rect',
      x: P,
      y: footerTop - gap - 2 * s,
      w: contentW,
      h: 2 * s,
      color: 'fg',
      alpha: 0.15,
    });
  }
  if (coverH) {
    elements.push({
      type: 'image',
      image: 'cover',
      x: P,
      y: middle - coverH / 2,
      w: coverW,
      h: coverH,
      radius: 6 * s,
    });
  }
  if (input.qrUrl) {
    elements.push({
      type: 'qr',
      value: input.qrUrl,
      x: W - P - qrSize,
      y: middle - qrSize / 2,
      w: qrSize,
      h: qrSize,
    });
  }
  // Book info and the signature end short of the QR code.
  const end = W - P - (qrSize ? qrSize + 32 * s : 0);
  const offset = coverW ? coverW + 28 * s : 0;
  const rowsW = end - P - offset;
  const rowsTop = middle - rowsHeight(rows) / 2;
  const last = rows.at(-1);
  if (last && qrSize) {
    last.text = ellipsize(last.text, last.font, rowsW - word.width - 24 * s, measure);
  }
  elements.push(...drawRows(fr, rows, P + offset, rowsTop, rowsW, 'left'));
  if (qrSize) {
    const wordY = last ? rowsTop + rowsHeight(rows) - last.h / 2 : middle;
    elements.push(word.at(end, wordY, 'right'));
  }
  return finish(fr, elements, H, block);
};

const centered: LayoutFn = (input, measure) => {
  const fr = createFrame(input, measure);
  const { s, P, W, info } = fr;
  const contentW = W - 2 * P;

  const rows: Row[] = [];
  if (info.author) rows.push({ text: `— ${info.author}`, font: fr.font(30 * s, 500), h: 46 * s });
  if (info.title)
    rows.push({ text: info.title, font: fr.font(28 * s, 400, true), h: 42 * s, alpha: 0.8 });
  if (info.date) rows.push({ text: info.date, font: fr.font(24 * s), h: 36 * s, color: 'accent' });
  const attribution = rows.length ? 56 * s + 4 * s + 36 * s + rowsHeight(rows) : 0;
  const mark = brand(fr);
  const logoRow = mark.height ? 56 * s + mark.height : 0;

  const chrome = P + attribution + logoRow + P;
  const block = fitQuote(fr, contentW, chrome, { min: 30, max: 68, lineHeight: 1.5 });
  const H = fr.isFit ? chrome + block.height : fr.size.height;
  const top = P + (H - chrome - block.height) / 2;

  const elements = quoteLines(fr, block, P, top, contentW, 'center');
  if (rows.length) {
    const ruleY = top + block.height + 56 * s;
    elements.push({
      type: 'rect',
      x: W / 2 - 30 * s,
      y: ruleY,
      w: 60 * s,
      h: 4 * s,
      color: 'accent',
    });
    elements.push(...drawRows(fr, rows, P, ruleY + 40 * s, contentW, 'center'));
  }
  elements.push(...mark.place(W / 2, H - P - mark.height, 'center'));
  return finish(fr, elements, H, block);
};

const cover: LayoutFn = (input, measure) => {
  if (!input.showBookInfo || !input.coverAspect) return classic(input, measure);
  const fr = createFrame(input, measure);
  const { s, P, W, info } = fr;
  const aspect = clamp(input.coverAspect, 0.5, 1);
  const rows: Row[] = [];
  if (info.title) rows.push({ text: info.title, font: fr.font(34 * s, 600), h: 48 * s });
  if (info.author) rows.push({ text: info.author, font: fr.font(28 * s), h: 40 * s, alpha: 0.8 });
  const mark = brand(fr);
  const logoRow = mark.height ? 48 * s + mark.height : 0;

  if (input.shape === 'wide') {
    // Cover in a left column, quote and attribution beside it.
    const coverH = fr.size.height - 2 * P;
    const coverW = coverH * aspect;
    const colX = P + coverW + 64 * s;
    const colW = W - P - colX;
    const attribution = rows.length ? 40 * s + rowsHeight(rows) : 0;
    const chrome = P + attribution + logoRow + P;
    const block = fitQuote(fr, colW, chrome, { min: 24, max: 52 });
    const H = fr.size.height;
    const top = P + (H - chrome - block.height) / 2;
    const elements: QuoteCardElement[] = [
      { type: 'image', image: 'cover', x: P, y: P, w: coverW, h: coverH, radius: 8 * s },
      ...quoteLines(fr, block, colX, top, colW, 'left'),
      ...drawRows(fr, rows, colX, top + block.height + 40 * s, colW, 'left'),
      ...mark.place(colX, H - P - mark.height, 'left'),
    ];
    return finish(fr, elements, H, block);
  }

  const contentW = W - 2 * P;
  const coverH = (input.shape === 'square' ? 300 : 420) * s;
  const coverW = coverH * aspect;
  const headH = coverH + 32 * s + rowsHeight(rows) + 40 * s + 3 * s + 40 * s;
  const chrome = P + headH + logoRow + P;
  const block = fitQuote(fr, contentW, chrome, { min: 26, max: 52 });
  const H = fr.isFit ? chrome + block.height : fr.size.height;
  const ruleY = P + coverH + 32 * s + rowsHeight(rows) + 40 * s;
  const elements: QuoteCardElement[] = [
    {
      type: 'image',
      image: 'cover',
      x: (W - coverW) / 2,
      y: P,
      w: coverW,
      h: coverH,
      radius: 8 * s,
    },
    ...drawRows(fr, rows, P, P + coverH + 32 * s, contentW, 'center'),
    { type: 'rect', x: W / 2 - 30 * s, y: ruleY, w: 60 * s, h: 3 * s, color: 'accent' },
    ...quoteLines(fr, block, P, P + headH, contentW, 'left'),
    ...mark.place(W / 2, H - P - mark.height, 'center'),
  ];
  return finish(fr, elements, H, block);
};

const page: LayoutFn = (input, measure) => {
  const fr = createFrame(input, measure);
  const { s, P, W, info } = fr;
  const contentW = W - 2 * P;
  const hasHead = !!(info.chapter || info.title);
  const headH = hasHead ? 40 * s + 2 * s + 48 * s : 0;
  const mark = brand(fr);
  // Page-style footer: attribution at the start, the brand block at the end.
  const foot = [info.author && `— ${info.author}`, info.date].filter(Boolean).join(' · ');
  const footH = Math.max(mark.height, foot ? 36 * s : 0);
  const footRow = footH ? 48 * s + footH : 0;

  const chrome = P + headH + footRow + P;
  const block = fitQuote(fr, contentW, chrome, { min: 26, max: 52, lineHeight: 1.75 });
  const H = fr.isFit ? chrome + block.height : fr.size.height;
  const top = P + headH;

  const elements: QuoteCardElement[] = [];
  if (hasHead) {
    const headFont = fr.font(24 * s);
    const half = contentW / 2 - 12 * s;
    if (info.chapter) {
      elements.push(
        text(
          fr,
          ellipsize(info.chapter, headFont, half, measure),
          P,
          P + 14 * s,
          headFont,
          'left',
          'fg',
          0.55,
        ),
      );
    }
    if (info.title) {
      const titleFont = fr.font(24 * s, 400, true);
      elements.push(
        text(
          fr,
          ellipsize(info.title, titleFont, half, measure),
          W - P,
          P + 14 * s,
          titleFont,
          'right',
          'fg',
          0.55,
        ),
      );
    }
    elements.push({
      type: 'rect',
      x: P,
      y: P + 40 * s,
      w: contentW,
      h: 2 * s,
      color: 'fg',
      alpha: 0.15,
    });
  }
  // A translucent highlighter stroke behind each line, the way the passage
  // looks highlighted in the reader.
  for (const line of block.lines) {
    const w = Math.min(line.width, contentW) + 16 * s;
    elements.push({
      type: 'rect',
      x: P - 8 * s,
      y: top + line.y - block.lineHeight * 0.36,
      w,
      h: block.lineHeight * 0.72,
      color: 'accent',
      alpha: 0.2,
      radius: 4 * s,
    });
  }
  elements.push(...quoteLines(fr, block, P, top, contentW, 'left'));

  const footTop = H - P - footH;
  const footY = footTop + footH / 2;
  if (foot) {
    const footFont = fr.font(24 * s);
    const room = contentW - (mark.width ? mark.width + 24 * s : 0);
    elements.push(
      text(fr, ellipsize(foot, footFont, room, measure), P, footY, footFont, 'left', 'fg', 0.7),
    );
  }
  elements.push(...mark.place(W - P, footTop, 'right'));
  return finish(fr, elements, H, block);
};

export const QUOTE_CARD_LAYOUTS: Record<QuoteCardLayoutId, LayoutFn> = {
  classic,
  centered,
  cover,
  page,
};
