import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import type { CrossPointAnchor } from '@/types/book';
import { XCFI } from '@/utils/xcfi';

// CrossPoint (crosspoint-reader firmware) anchors a clipping at its spine
// index and a [start, end) range of code points counted over every character
// of the section's <body>, whitespace included, outside head, style, script,
// title and rp (ChapterHtmlSlimParser::characterData). foliate parses a
// section as XML like the firmware does, so its text nodes are the
// firmware's character data.

type Offsets = Pick<CrossPointAnchor, 'start_offset' | 'end_offset'>;
type Run = { node: CharacterData; start: number; length: number };

const SKIPPED = new Set(['head', 'style', 'script', 'title', 'rp']);

const codePoints = (text: string) => Array.from(text).length;

/** UTF-16 index of the code point `points` into `text`. */
const unitIndex = (text: string, points: number) => {
  let index = 0;
  for (let n = 0; n < points && index < text.length; n++) {
    index += text.codePointAt(index)! > 0xffff ? 2 : 1;
  }
  return index;
};

const textRuns = (doc: Document) => {
  const runs: Run[] = [];
  let offset = 0;
  const walk = (parent: Node) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        const length = codePoints((node as CharacterData).data);
        runs.push({ node: node as CharacterData, start: offset, length });
        offset += length;
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        !SKIPPED.has((node as Element).localName.toLowerCase())
      ) {
        walk(node);
      }
    }
  };
  const body = doc.getElementsByTagName('body')[0];
  if (body) walk(body);
  return runs;
};

/** The text the firmware counted over [start, end), without what it skips. */
const visibleText = (runs: Run[], start: number, end: number) =>
  runs
    .filter((run) => run.start + run.length > start && run.start < end)
    .map((run) => {
      const points = Array.from(run.node.data);
      return points.slice(Math.max(0, start - run.start), end - run.start).join('');
    })
    .join('');

const domPoint = (runs: Run[], offset: number, isEnd: boolean) => {
  const run = runs.find((r) =>
    isEnd
      ? r.start < offset && offset <= r.start + r.length
      : r.start <= offset && offset < r.start + r.length,
  );
  return run && { node: run.node, offset: unitIndex(run.node.data, offset - run.start) };
};

const rangeAt = (doc: Document, runs: Run[], start: number, end: number) => {
  const from = domPoint(runs, start, false);
  const to = domPoint(runs, end, true);
  if (!from || !to) return null;
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
};

// The firmware joins a clipping's words with one space or a newline, drops
// soft hyphens and composes to NFC, so compare text without any of that.
const IGNORED = /[\s­]/u;
const squash = (text: string) => text.normalize('NFC').replace(/[\s­]/gu, '');

/** The clipping's text in the section, at its offsets or else nearest them. */
export const clippingRange = (doc: Document, anchor: Offsets, text: string): Range | null => {
  const wanted = squash(text);
  if (!wanted) return null;
  const runs = textRuns(doc);
  const { start_offset: start, end_offset: end } = anchor;
  if (start !== undefined && end !== undefined && end > start) {
    if (squash(visibleText(runs, start, end)) === wanted) return rangeAt(doc, runs, start, end);
  }
  // Each UTF-16 unit of the squashed section text, with the offset of its code point.
  let squashed = '';
  const offsetAt: number[] = [];
  for (const run of runs) {
    let offset = run.start;
    for (const char of run.node.data) {
      if (!IGNORED.test(char)) {
        squashed += char;
        for (let i = 0; i < char.length; i++) offsetAt.push(offset);
      }
      offset++;
    }
  }
  let best = -1;
  for (let i = squashed.indexOf(wanted); i >= 0; i = squashed.indexOf(wanted, i + 1)) {
    if (
      best < 0 ||
      Math.abs(offsetAt[i]! - (start ?? 0)) < Math.abs(offsetAt[best]! - (start ?? 0))
    )
      best = i;
  }
  if (best < 0) return null;
  return rangeAt(doc, runs, offsetAt[best]!, offsetAt[best + wanted.length - 1]! + 1);
};

const offsetOf = (runs: Run[], container: Node, offset: number) => {
  const run = runs.find((r) => r.node === container);
  if (run) return run.start + codePoints(run.node.data.slice(0, offset));
  // A boundary between nodes: the text of every run before it.
  const point = container.ownerDocument!.createRange();
  point.setStart(container, offset);
  let total = 0;
  for (const r of runs) {
    if (point.comparePoint(r.node, 0) >= 0) break;
    total = r.start + r.length;
  }
  return total;
};

/** A selection's range in CrossPoint code points, or null when it has no text. */
export const clippingOffsets = (doc: Document, range: Range): Offsets | null => {
  const runs = textRuns(doc);
  const start = offsetOf(runs, range.startContainer, range.startOffset);
  const end = offsetOf(runs, range.endContainer, range.endOffset);
  return end > start ? { start_offset: start, end_offset: end } : null;
};

/** The CFI of a CrossPoint clipping, read in its own section. */
export const getCFIFromCrossPointAnchor = async (
  anchor: CrossPointAnchor,
  text: string,
  bookDoc: BookDoc,
) => {
  const doc = await bookDoc.sections?.[anchor.spine]?.createDocument();
  const range = doc && clippingRange(doc, anchor, text);
  return range ? CFI.joinIndir(CFI.fake.fromIndex(anchor.spine), CFI.fromRange(range)) : null;
};

/** Where CrossPoint would anchor the text a range CFI covers. */
export const getCrossPointAnchorFromCFI = async (
  cfi: string,
  bookDoc: BookDoc,
): Promise<CrossPointAnchor | null> => {
  const spine = XCFI.extractSpineIndex(cfi);
  const doc = await bookDoc.sections?.[spine]?.createDocument();
  const parts = CFI.parse(cfi);
  if (!doc || !parts.parent) return null;
  parts.parent.shift(); // the spine step
  const offsets = clippingOffsets(doc, CFI.toRange(doc, parts));
  return offsets && { spine, ...offsets };
};
