import * as CFI from 'foliate-js/epubcfi.js';
import type { ChunkRow } from '../db/types';

/**
 * CFI-aware chunker. Walks an EPUB section's DOM via TreeWalker, accumulates
 * text from <body>, and slices it into ~maxChunkSize windows with paragraph >
 * sentence > word break-points. Each chunk carries the full epubcfi(/6/N!/…)
 * range for its first and last character positions so the retriever can hand
 * back navigable anchors.
 *
 * MVP scope (per plan §M1.3):
 *  - Plain text only; image-only sections produce zero chunks (callers handle
 *    that via the BookIndexer's `empty_index` status).
 *  - Skips `<script>`, `<style>`, `<noscript>` and any node marked with the
 *    `cfi-inert` class.
 *  - Verifies every generated CFI round-trips via CFI.toRange against the
 *    section document. Mismatches are dropped with a console warning rather
 *    than silently writing bad data.
 */

export interface ChunkOptions {
  /** Target chunk size in characters. */
  maxChunkSize: number;
  /** Minimum acceptable chunk size; smaller tails are merged into the prior chunk. */
  minChunkSize: number;
  /** Characters of overlap between adjacent chunks (re-emitted from the end of the prior chunk). */
  overlapSize: number;
  /** Maximum chars to search left/right of the target boundary for a break-point. */
  breakSearchRange: number;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 500,
  minChunkSize: 100,
  overlapSize: 50,
  breakSearchRange: 50,
};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

interface TextSlice {
  node: Text;
  /** Cumulative character offset of this text node's first char within the section's flat string. */
  cumStart: number;
}

/**
 * Walk the document body collecting text nodes alongside their position in
 * the flat concatenated string we use for break-point detection.
 */
function collectTextNodes(doc: Document): { slices: TextSlice[]; flatText: string } {
  const body = doc.body ?? doc.documentElement;
  if (!body) return { slices: [], flatText: '' };

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p: Node | null = node.parentNode;
      while (p && p.nodeType === 1) {
        const el = p as Element;
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.classList?.contains('cfi-inert')) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return (node.nodeValue ?? '').length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const slices: TextSlice[] = [];
  const parts: string[] = [];
  let cum = 0;
  let n: Node | null = walker.nextNode();
  while (n) {
    const text = (n as Text).nodeValue ?? '';
    slices.push({ node: n as Text, cumStart: cum });
    parts.push(text);
    cum += text.length;
    n = walker.nextNode();
  }
  return { slices, flatText: parts.join('') };
}

/**
 * Map a cumulative character offset to a (text node, offset-within-node) pair.
 * Caller guarantees `0 <= offset <= flatText.length`.
 */
function offsetToNode(slices: TextSlice[], offset: number): { node: Text; offset: number } | null {
  if (slices.length === 0) return null;
  // Binary search for the slice whose cumStart <= offset < next cumStart.
  let lo = 0;
  let hi = slices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (slices[mid]!.cumStart <= offset) lo = mid;
    else hi = mid - 1;
  }
  const slice = slices[lo]!;
  const within = offset - slice.cumStart;
  const nodeLen = (slice.node.nodeValue ?? '').length;
  // Clamp to node length so the very last position resolves to end of last node.
  return { node: slice.node, offset: Math.min(within, nodeLen) };
}

function findBreakPoint(text: string, targetPos: number, searchRange: number): number {
  const start = Math.max(0, targetPos - searchRange);
  const end = Math.min(text.length, targetPos + searchRange);
  const window = text.slice(start, end);

  // Prefer paragraph break, then sentence terminator + space, then word break.
  const paragraphBreak = window.lastIndexOf('\n\n');
  if (paragraphBreak !== -1 && paragraphBreak > searchRange / 2) {
    return start + paragraphBreak + 2;
  }
  const sentenceBreak = window.lastIndexOf('. ');
  if (sentenceBreak !== -1 && sentenceBreak > searchRange / 2) {
    return start + sentenceBreak + 2;
  }
  const wordBreak = window.lastIndexOf(' ');
  if (wordBreak !== -1) {
    return start + wordBreak + 1;
  }
  return targetPos;
}

function composeSectionCfi(innerCfiWrapped: string, sectionIndex: number): string {
  // fromRange returns "epubcfi(/4/2[p1],/1:0,/1:5)" — unwrap, then prepend
  // the spine itemref step "/6/{(sectionIndex+1)*2}!" matching the pattern
  // foliate-js uses for full document CFIs (see src/utils/xcfi.ts).
  const m = innerCfiWrapped.match(/^epubcfi\((.+)\)$/);
  if (!m) return innerCfiWrapped;
  const spineStep = (sectionIndex + 1) * 2;
  return `epubcfi(/6/${spineStep}!${m[1]!})`;
}

function tokenCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function chunkSection(
  doc: Document,
  sectionIndex: number,
  chapterTitle: string,
  bookHash: string,
  options?: Partial<ChunkOptions>,
): ChunkRow[] {
  const opts: ChunkOptions = { ...DEFAULT_OPTIONS, ...options };
  const { slices, flatText } = collectTextNodes(doc);
  if (flatText.trim().length === 0 || slices.length === 0) return [];

  const totalLen = flatText.length;
  // Below the minimum chunk size, emit the whole section as one chunk so very
  // short sections (a single paragraph, a back-cover blurb) still get indexed.
  if (totalLen < opts.minChunkSize) {
    return buildChunks(
      [{ start: 0, end: totalLen }],
      flatText,
      slices,
      doc,
      sectionIndex,
      chapterTitle,
      bookHash,
    );
  }

  const windows: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < totalLen) {
    const targetEnd = cursor + opts.maxChunkSize;
    if (targetEnd >= totalLen) {
      windows.push({ start: cursor, end: totalLen });
      break;
    }
    const snappedEnd = findBreakPoint(flatText, targetEnd, opts.breakSearchRange);
    // Guarantee forward progress even if the breakpoint search returns <= cursor.
    const end = snappedEnd > cursor ? snappedEnd : Math.min(totalLen, cursor + opts.maxChunkSize);
    windows.push({ start: cursor, end });
    cursor = end > opts.overlapSize ? end - opts.overlapSize : end;
    if (cursor >= totalLen) break;
  }

  return buildChunks(windows, flatText, slices, doc, sectionIndex, chapterTitle, bookHash);
}

function buildChunks(
  windows: Array<{ start: number; end: number }>,
  flatText: string,
  slices: TextSlice[],
  doc: Document,
  sectionIndex: number,
  chapterTitle: string,
  bookHash: string,
): ChunkRow[] {
  const out: ChunkRow[] = [];
  let position = 0;
  for (const w of windows) {
    const sliceText = flatText.slice(w.start, w.end).trim();
    if (sliceText.length === 0) continue;
    const startPair = offsetToNode(slices, w.start);
    // For the end position we want the END of the chunk character, not the
    // start, so step one past the last char (clamped to total length).
    const endPair = offsetToNode(slices, Math.min(flatText.length, w.end));
    if (!startPair || !endPair) continue;

    let range: Range;
    try {
      range = doc.createRange();
      range.setStart(startPair.node, startPair.offset);
      range.setEnd(endPair.node, endPair.offset);
    } catch (err) {
      console.warn('[Reedy] chunk_cfi_mismatch: failed to build range', err);
      continue;
    }

    let startInner: string;
    let endInner: string;
    try {
      const startCollapsed = doc.createRange();
      startCollapsed.setStart(startPair.node, startPair.offset);
      startCollapsed.collapse(true);
      const endCollapsed = doc.createRange();
      endCollapsed.setStart(endPair.node, endPair.offset);
      endCollapsed.collapse(true);
      startInner = CFI.fromRange(startCollapsed);
      endInner = CFI.fromRange(endCollapsed);
    } catch (err) {
      console.warn('[Reedy] chunk_cfi_mismatch: fromRange threw', err);
      continue;
    }

    // Round-trip verification: parsing the generated CFI must resolve to a
    // range whose start position equals the original position. We don't
    // require the resolved text to match exactly because toRange of a
    // collapsed CFI returns a zero-length range — we just need a valid node
    // reference.
    if (!verifyRoundTrip(doc, startInner, startPair) || !verifyRoundTrip(doc, endInner, endPair)) {
      console.warn('[Reedy] chunk_cfi_mismatch: CFI failed round-trip verification', {
        sectionIndex,
        position,
      });
      continue;
    }

    out.push({
      id: `${bookHash}-${sectionIndex}-${position}`,
      bookHash,
      sectionIndex,
      chapterTitle,
      startCfi: composeSectionCfi(startInner, sectionIndex),
      endCfi: composeSectionCfi(endInner, sectionIndex),
      positionIndex: position,
      text: sliceText,
      tokenCount: tokenCount(sliceText),
    });
    position++;
  }
  return out;
}

function verifyRoundTrip(
  doc: Document,
  innerCfiWrapped: string,
  expected: { node: Text; offset: number },
): boolean {
  try {
    const parts = CFI.parse(innerCfiWrapped);
    const resolved = CFI.toRange(doc, parts);
    if (!resolved) return false;
    // Loose match: same text node, offset within ±1 (CFI normalization can
    // collapse a zero-length character difference at node boundaries).
    if (resolved.startContainer !== expected.node) return false;
    return Math.abs(resolved.startOffset - expected.offset) <= 1;
  } catch {
    return false;
  }
}
