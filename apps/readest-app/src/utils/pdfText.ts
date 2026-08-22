/**
 * Reassembles paragraphs from a pdf.js text layer.
 *
 * pdf.js renders one <span> per text run and a <br role="presentation"> at every
 * end of line, so walking a selection yields one line of text per printed line
 * (#5814). PDF carries no paragraph markup; each <br> is classified from the
 * page's geometry instead. A line ends a paragraph when it is followed by a
 * larger-than-usual vertical step, a font-size change, a centred line, an
 * indented first line, or when it stops early even though the next line's
 * first word would have fit on it. Any other <br> is a line wrap: joined with
 * a space (none between CJK characters), dropping a line-end hyphen before a
 * lowercase continuation.
 */

export type PdfLineBreak = 'paragraph' | 'space' | 'join' | 'dehyphenate';

export interface PdfLine {
  text: string;
  /** Horizontal extent of the line's text, px in any consistent space. */
  left: number;
  right: number;
  /** Top of the line's dominant (longest) run, so superscripts don't skew it. */
  top: number;
  /** Height of the dominant run, used as the em unit. Zero when not laid out. */
  em: number;
  /** Rendered width of the line's first word. */
  firstWordWidth: number;
}

/** Vertical step beyond this multiple of the page's line pitch ends a paragraph. */
const PARAGRAPH_GAP_RATIO = 1.3;
const FONT_SIZE_TOLERANCE = 0.2;
/** Lines whose left edges lie within this many em of each other share a column. */
const COLUMN_TOLERANCE_EM = 4;
const WORD_SPACE_EM = 0.3;

const HYPHEN_AT_END = /[-\u2010\u00AD]\s*$/u;
const SOFT_HYPHEN_AT_END = /\u00AD\s*$/u;
// Scripts set without inter-word spaces, plus their punctuation blocks.
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;

const isMeasured = (line: PdfLine) => line.em > 0 && line.right > line.left;

const medianPitch = (lines: PdfLine[]): number | null => {
  const steps: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (!isMeasured(a) || !isMeasured(b)) continue;
    const dy = b.top - a.top;
    if (dy > 0.5 * Math.max(a.em, b.em)) steps.push(dy);
  }
  if (!steps.length) return null;
  steps.sort((x, y) => x - y);
  // Lower median: paragraph gaps are the minority and must not pull it up.
  return steps[Math.floor((steps.length - 1) / 2)]!;
};

// Edges of the column `line` sits in, from the same-font lines sharing its
// left edge. Right: the 85th percentile of their right edges, so a few
// full-width lines (a title above two columns) don't widen the column. Left:
// the most populated 1em bin of their left edges (ties go right, so fewer
// lines count as indented), which is the continuation edge of a hanging
// indent and the body edge of indented prose.
const columnEdges = (line: PdfLine, lines: PdfLine[], em: number) => {
  const group = lines.filter(
    (l) =>
      isMeasured(l) &&
      Math.abs(l.left - line.left) <= COLUMN_TOLERANCE_EM * em &&
      Math.abs(l.em - line.em) <= FONT_SIZE_TOLERANCE * em,
  );
  const rights = group.map((l) => l.right).sort((x, y) => x - y);
  const right = rights[Math.ceil(0.85 * rights.length) - 1] ?? line.right;
  const bins = new Map<number, number[]>();
  for (const l of group) {
    const key = Math.round(l.left / em);
    bins.set(key, [...(bins.get(key) ?? []), l.left]);
  }
  let best: number[] = [line.left];
  let bestKey = -Infinity;
  for (const [key, lefts] of bins) {
    if (lefts.length > best.length || (lefts.length === best.length && key > bestKey)) {
      best = lefts;
      bestKey = key;
    }
  }
  const left = best.reduce((sum, l) => sum + l, 0) / best.length;
  return { left, right };
};

const joinKind = (aText: string, bText: string): PdfLineBreak => {
  const aEnd = aText.trimEnd();
  const bStart = bText.trimStart();
  if (SOFT_HYPHEN_AT_END.test(aEnd)) return 'dehyphenate';
  if (HYPHEN_AT_END.test(aEnd)) return /^\p{Ll}/u.test(bStart) ? 'dehyphenate' : 'join';
  if (aEnd !== aText || bStart !== bText) return 'join';
  const last = [...aEnd].at(-1) ?? '';
  const first = [...bStart][0] ?? '';
  if (NO_SPACE_SCRIPT.test(last) || NO_SPACE_SCRIPT.test(first)) return 'join';
  return 'space';
};

const classifyBreak = (
  a: PdfLine,
  b: PdfLine,
  lines: PdfLine[],
  pitch: number | null,
): PdfLineBreak => {
  if (!isMeasured(a) || !isMeasured(b)) return 'paragraph';
  const em = Math.max(a.em, b.em);
  const dy = b.top - a.top;
  // Two runs of the same printed line: continue it.
  if (Math.abs(dy) < 0.5 * em && b.left >= a.right - 0.5 * em) return joinKind(a.text, b.text);
  if (dy > PARAGRAPH_GAP_RATIO * (pitch ?? 1.2 * em)) return 'paragraph';
  if (Math.abs(a.em - b.em) > FONT_SIZE_TOLERANCE * em) return 'paragraph';
  // Centred lines (titles, verse) are set one per line.
  if (Math.abs(a.left - b.left) > em && Math.abs(a.left + a.right - b.left - b.right) < 0.5 * em) {
    return 'paragraph';
  }
  const column = columnEdges(a, lines, em);
  // An indented line after an unindented one opens a paragraph. Continuation
  // lines of list items and hanging indents follow an indented line or sit on
  // the column's usual edge, so they don't qualify.
  const indent = b.left - column.left;
  if (indent > em && indent < COLUMN_TOLERANCE_EM * em && a.left - column.left < em) {
    return 'paragraph';
  }
  // The line stopped early although the next word would have fit: deliberate end.
  if (column.right - a.right > b.firstWordWidth + WORD_SPACE_EM * em) return 'paragraph';
  return joinKind(a.text, b.text);
};

/** The break kind after each line; `lines.length - 1` entries. */
export const classifyPdfLineBreaks = (lines: PdfLine[]): PdfLineBreak[] => {
  const pitch = medianPitch(lines);
  const breaks: PdfLineBreak[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    breaks.push(classifyBreak(lines[i]!, lines[i + 1]!, lines, pitch));
  }
  return breaks;
};

interface TextLayerRow {
  spans: Element[];
  br: Element | null;
}

const splitRows = (textLayer: Element): TextLayerRow[] => {
  const rows: TextLayerRow[] = [];
  let row: TextLayerRow = { spans: [], br: null };
  for (const child of Array.from(textLayer.children)) {
    if (child.tagName === 'BR') {
      row.br = child;
      rows.push(row);
      row = { spans: [], br: null };
    } else {
      row.spans.push(child);
    }
  }
  if (row.spans.length) rows.push(row);
  return rows;
};

const measureRow = ({ spans }: TextLayerRow): PdfLine => {
  const line: PdfLine = {
    text: '',
    left: Infinity,
    right: -Infinity,
    top: 0,
    em: 0,
    firstWordWidth: 0,
  };
  let dominantLength = 0;
  for (const span of spans) {
    const text = span.textContent ?? '';
    line.text += text;
    const trimmed = text.trim();
    if (!trimmed) continue;
    const rect = span.getBoundingClientRect();
    line.left = Math.min(line.left, rect.left);
    line.right = Math.max(line.right, rect.right);
    if (trimmed.length > dominantLength) {
      dominantLength = trimmed.length;
      line.top = rect.top;
      line.em = rect.height;
    }
    if (!line.firstWordWidth) {
      const word = trimmed.split(/\s+/)[0] ?? '';
      line.firstWordWidth = (rect.width * word.length) / trimmed.length;
    }
  }
  return line;
};

const sliceText = (el: Element, range: Range) => {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue;
    const data = (node as Text).data;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : data.length;
    out += data.slice(start, end);
  }
  return out;
};

/** The pdf.js text layer `range` lies in, if any. */
export const getPdfTextLayer = (range: Range): Element | null => {
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.textLayer') ?? null;
};

/** Text of `range` with the text layer's line wraps joined back into paragraphs. */
export const getPdfTextFromRange = (range: Range, textLayer: Element): string => {
  const rows = splitRows(textLayer);
  const breaks = classifyPdfLineBreaks(rows.map(measureRow));
  let text = '';
  let pending = '';
  rows.forEach((row, i) => {
    for (const span of row.spans) {
      if (!range.intersectsNode(span)) continue;
      const piece = sliceText(span, range);
      if (!piece) continue;
      if (text) text += pending;
      pending = '';
      text += piece;
    }
    if (!row.br || !range.intersectsNode(row.br)) return;
    const kind = breaks[i] ?? 'paragraph';
    if (kind === 'dehyphenate') {
      text = text.replace(HYPHEN_AT_END, '');
      pending = '';
    } else {
      pending = kind === 'paragraph' ? '\n' : kind === 'space' ? ' ' : '';
    }
  });
  return text;
};
