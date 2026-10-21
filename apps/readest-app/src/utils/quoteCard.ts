// Quote card model and text layout (#5830). Pure: every width comes from the
// injected `measure`, so layouts are unit-testable without a canvas and the
// preview and the exported PNG come from the same numbers.

export type QuoteCardLayoutId = 'classic' | 'centered' | 'cover' | 'page';
export type QuoteCardColorsId = 'paper' | 'night' | 'sepia' | 'reader';
export type QuoteCardShape = 'fit' | 'portrait' | 'square' | 'wide';
export type QuoteCardFont = 'serif' | 'sans';
export type QuoteCardColorRole = 'fg' | 'accent' | 'bg';

export interface QuoteCardColors {
  bg: string;
  fg: string;
  accent: string;
}

export const QUOTE_CARD_COLORS: Record<Exclude<QuoteCardColorsId, 'reader'>, QuoteCardColors> = {
  paper: { bg: '#fbf8f1', fg: '#1f1d1a', accent: '#a0703c' },
  night: { bg: '#15130f', fg: '#e9dfc8', accent: '#c9a45c' },
  sepia: { bg: '#f1e6cd', fg: '#4a3b2a', accent: '#9a6b3a' },
};

// `fit` keeps the width and grows the height with the quote: `height` is the
// target the font size is chosen for, `maxHeight` the cap past which it truncates.
export const QUOTE_CARD_SIZES: Record<
  QuoteCardShape,
  { width: number; height: number; maxHeight?: number }
> = {
  fit: { width: 1080, height: 1350, maxHeight: 6480 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  wide: { width: 1600, height: 900 },
};

// Fallback stacks; the card normally uses the reader's font settings. The
// reader mounts these web fonts into the app document, and the system fallbacks
// cover offline use and CJK.
export const QUOTE_CARD_FONTS: Record<QuoteCardFont, string> = {
  serif:
    'Literata, "PT Serif", Georgia, "Noto Serif", "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", serif',
  sans: '"Noto Sans", Inter, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
};

export interface QuoteCardInput {
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
  date?: string;
  showBookInfo: boolean;
  // Cover width / height; undefined when the book has no usable cover.
  coverAspect?: number;
  shape: QuoteCardShape;
  fontFamily: string;
  // Link to the passage; when set, the card carries it as a QR code.
  qrUrl?: string;
  // The quote as styled runs (bold / italic); `text` is used when absent.
  runs?: QuoteCardRun[];
  // The signature beside the QR code, e.g. a translated "via Readest".
  brand?: string;
}

export type QuoteCardElement =
  | {
      type: 'text';
      text: string;
      x: number;
      // Vertical middle of the line (drawn with textBaseline 'middle').
      y: number;
      font: string;
      color: QuoteCardColorRole;
      align: 'left' | 'right' | 'center';
      dir: 'ltr' | 'rtl';
      alpha?: number;
    }
  | {
      type: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      color: QuoteCardColorRole;
      alpha?: number;
      radius?: number;
    }
  | {
      type: 'image';
      image: 'cover';
      x: number;
      y: number;
      w: number;
      h: number;
      radius?: number;
    }
  | {
      type: 'qr';
      value: string;
      x: number;
      y: number;
      w: number;
      h: number;
    };

export interface QuoteCardLayout {
  width: number;
  height: number;
  elements: QuoteCardElement[];
  truncated: boolean;
}

export type MeasureText = (text: string, font: string) => number;

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;

export const getTextDirection = (text: string): 'ltr' | 'rtl' => {
  const first = /\p{L}/u.exec(text)?.[0];
  return first && RTL_CHAR.test(first) ? 'rtl' : 'ltr';
};

export interface QuoteCardRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export type RunStyle = Pick<QuoteCardRun, 'bold' | 'italic'>;
export interface TextPiece {
  text: string;
  font: string;
}

// Paragraphs of styled runs: split on '\n', whitespace collapsed within and
// across runs, each paragraph trimmed, empty runs and paragraphs dropped.
export const splitRuns = (runs: QuoteCardRun[]): QuoteCardRun[][] => {
  const paragraphs: QuoteCardRun[][] = [[]];
  for (const run of runs) {
    run.text.split('\n').forEach((part, i) => {
      if (i > 0) paragraphs.push([]);
      const paragraph = paragraphs.at(-1)!;
      let text = part.replace(/[ \t\u00a0]+/g, ' ');
      const prev = paragraph.at(-1);
      if (!prev || prev.text.endsWith(' ')) text = text.replace(/^ /, '');
      if (text) paragraph.push({ ...run, text });
    });
  }
  return paragraphs
    .map((paragraph) => {
      const last = paragraph.at(-1);
      if (last) last.text = last.text.trimEnd();
      return paragraph.filter((run) => run.text);
    })
    .filter((paragraph) => paragraph.length > 0);
};

export const splitParagraphs = (text: string): string[] =>
  splitRuns([{ text }]).map((paragraph) => paragraph.map((run) => run.text).join(''));

// CJK text breaks between any two characters, so word segments are split up.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// Closing punctuation hangs at the end of a line instead of starting the next.
const NO_LINE_START = /^[,.;:!?)\]}、。，．；：！？）】》〉」』”’…]+$/u;

const segment = (text: string): string[] => {
  const words =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
          (s) => s.segment,
        )
      : (text.match(/\s+|[^\s]+/g) ?? []);
  return words.flatMap((w) => (CJK_CHAR.test(w) ? Array.from(w) : [w]));
};

const piecesWidth = (pieces: TextPiece[], measure: MeasureText) =>
  pieces.reduce((width, piece) => width + measure(piece.text, piece.font), 0);

// Appends text to a line, merging it into the last piece when the font matches.
const appendPiece = (pieces: TextPiece[], text: string, font: string): TextPiece[] => {
  const last = pieces.at(-1);
  return last?.font === font
    ? [...pieces.slice(0, -1), { text: last.text + text, font }]
    : [...pieces, { text, font }];
};

// Greedy line breaking over styled runs; each line is a list of pieces, each
// in its own font.
export const wrapRuns = (
  runs: QuoteCardRun[],
  fontFor: (style: RunStyle) => string,
  maxWidth: number,
  measure: MeasureText,
): TextPiece[][] => {
  const lines: TextPiece[][] = [];
  let line: TextPiece[] = [];
  const push = () => {
    while (line.length && !line.at(-1)!.text.trim()) line.pop();
    const last = line.at(-1);
    if (last) lines.push([...line.slice(0, -1), { ...last, text: last.text.trimEnd() }]);
    line = [];
  };
  for (const run of runs) {
    const font = fontFor(run);
    for (const seg of segment(run.text)) {
      const candidate = appendPiece(line, seg, font);
      const hasText = line.some((piece) => piece.text.trim());
      if (piecesWidth(candidate, measure) <= maxWidth || (hasText && NO_LINE_START.test(seg))) {
        line = candidate;
        continue;
      }
      push();
      if (!seg.trim()) continue;
      if (measure(seg, font) <= maxWidth) {
        line = [{ text: seg, font }];
        continue;
      }
      for (const ch of Array.from(seg)) {
        if (line.length && piecesWidth(appendPiece(line, ch, font), measure) > maxWidth) push();
        line = appendPiece(line, ch, font);
      }
    }
  }
  push();
  return lines;
};

export const wrapText = (
  paragraph: string,
  font: string,
  maxWidth: number,
  measure: MeasureText,
): string[] =>
  wrapRuns([{ text: paragraph }], () => font, maxWidth, measure).map((pieces) =>
    pieces.map((piece) => piece.text).join(''),
  );

export const ellipsize = (
  text: string,
  font: string,
  maxWidth: number,
  measure: MeasureText,
): string => {
  if (measure(text, font) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length && measure(`${chars.join('').trimEnd()}…`, font) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
};

// Cuts a line so that it ends with an ellipsis within `maxWidth`.
const ellipsizePieces = (
  pieces: TextPiece[],
  maxWidth: number,
  measure: MeasureText,
): TextPiece[] => {
  const out = pieces.map((piece) => ({ ...piece }));
  while (out.length) {
    const last = out.at(-1)!;
    const text = `${last.text.trimEnd()}…`;
    if (piecesWidth([...out.slice(0, -1), { ...last, text }], measure) <= maxWidth) {
      last.text = text;
      return out;
    }
    last.text = Array.from(last.text).slice(0, -1).join('');
    if (!last.text) out.pop();
  }
  return [{ text: '…', font: pieces[0]?.font ?? '' }];
};

export interface TextBlockSpec {
  paragraphs: QuoteCardRun[][];
  width: number;
  fontFor: (size: number, style?: RunStyle) => string;
  minSize: number;
  maxSize: number;
  // Line box height as a multiple of the font size.
  lineHeight: number;
  // Extra space between paragraphs as a multiple of the font size.
  paragraphGap: number;
}

export interface TextLine {
  text: string;
  // Pieces with their x offset from the line start.
  pieces: (TextPiece & { x: number })[];
  width: number;
  // Vertical middle of the line, relative to the block top.
  y: number;
  paragraphStart: boolean;
}

export interface TextBlock {
  fontSize: number;
  font: string;
  lineHeight: number;
  lines: TextLine[];
  height: number;
  truncated: boolean;
}

const positionPieces = (pieces: TextPiece[], measure: MeasureText) => {
  let x = 0;
  const positioned = pieces.map((piece) => {
    const placed = { ...piece, x };
    x += measure(piece.text, piece.font);
    return placed;
  });
  return { pieces: positioned, width: x, text: pieces.map((piece) => piece.text).join('') };
};

const layoutBlock = (spec: TextBlockSpec, size: number, measure: MeasureText): TextBlock => {
  const lineHeight = size * spec.lineHeight;
  const gap = size * spec.paragraphGap;
  const lines: TextLine[] = [];
  let top = 0;
  spec.paragraphs.forEach((paragraph, p) => {
    if (p > 0) top += gap;
    const fontFor = (style: RunStyle) => spec.fontFor(size, style);
    wrapRuns(paragraph, fontFor, spec.width, measure).forEach((pieces, i) => {
      lines.push({
        ...positionPieces(pieces, measure),
        y: top + lineHeight / 2,
        paragraphStart: i === 0,
      });
      top += lineHeight;
    });
  });
  const font = spec.fontFor(size);
  return { fontSize: size, font, lineHeight, lines, height: top, truncated: false };
};

// Largest font size whose wrapped text fits `maxHeight`. When even `minSize`
// overflows, the block may grow to `overflowHeight` (the Fit shape) and is cut
// with an ellipsis beyond that.
export const fitTextBlock = (
  spec: TextBlockSpec,
  measure: MeasureText,
  { maxHeight, overflowHeight }: { maxHeight: number; overflowHeight?: number },
): TextBlock => {
  let lo = spec.minSize;
  let hi = spec.maxSize;
  let best: TextBlock | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = layoutBlock(spec, mid, measure);
    if (block.height <= maxHeight) {
      best = block;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return best;

  const block = layoutBlock(spec, spec.minSize, measure);
  const limit = Math.max(maxHeight, overflowHeight ?? 0);
  if (block.height <= limit) return block;

  const kept = block.lines.filter((line) => line.y + block.lineHeight / 2 <= limit);
  const last = kept.at(-1);
  if (last) {
    const pieces = ellipsizePieces(last.pieces, spec.width, measure);
    kept[kept.length - 1] = { ...last, ...positionPieces(pieces, measure) };
  }
  const height = last ? last.y + block.lineHeight / 2 : 0;
  return { ...block, lines: kept, height, truncated: true };
};
