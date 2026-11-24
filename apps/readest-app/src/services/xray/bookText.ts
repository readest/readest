import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import { XCFI } from '@/utils/xcfi';

const SKIPPED = 'script, style, noscript, template, rt, rp, .cfi-inert';
const BLOCKS =
  'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption, div, section, body';

interface TextNode {
  node: Text;
  /** Where its text starts in the section's. */
  start: number;
  /** Its leading white space was dropped, as the text before it ends in some. */
  trimmed: boolean;
}

/** A section's text with its white space collapsed, and the way back into its document. */
export class SectionText {
  readonly text: string;
  private readonly nodes: TextNode[] = [];

  constructor(
    private readonly doc: Document,
    private readonly baseCfi: string,
  ) {
    const parts: string[] = [];
    let length = 0;
    let space = true;
    let block: Element | null = null;
    const add = (part: string) => {
      parts.push(part);
      length += part.length;
      space = part.endsWith(' ');
    };
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 5, (node) =>
      node.nodeType === 1
        ? (node as Element).matches(SKIPPED)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP
        : NodeFilter.FILTER_ACCEPT,
    );
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text) {
      const own = node.parentElement!.closest(BLOCKS);
      if (own !== block && !space) add(' ');
      block = own;
      let text = node.data.replace(/\s+/g, ' ');
      const trimmed = space && text.startsWith(' ');
      if (trimmed) text = text.slice(1);
      if (!text) continue;
      this.nodes.push({ node, start: length, trimmed });
      add(text);
    }
    this.text = parts.join('');
  }

  private nodeAt(offset: number): TextNode {
    let low = 0;
    let high = this.nodes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.nodes[middle]!.start <= offset) low = middle;
      else high = middle - 1;
    }
    return this.nodes[low]!;
  }

  /** The CFI of the character at `offset`. */
  cfiAt(offset: number): string {
    const { node, start, trimmed } = this.nodeAt(offset);
    const { data } = node;
    // Walk the node's own white space back in.
    let raw = trimmed ? data.search(/\S|$/) : 0;
    for (let left = offset - start; left > 0 && raw < data.length; left--) {
      if (/\s/.test(data[raw]!)) while (/\s/.test(data[raw + 1] ?? '')) raw++;
      raw++;
    }
    const range = this.doc.createRange();
    range.setStart(node, raw);
    return CFI.joinIndir(this.baseCfi, CFI.fromRange(range));
  }

  /** Where the page at `location`, in this section, starts in its text. */
  offsetOf(location: string): number {
    const parts = CFI.parse(location);
    (parts.parent ?? parts).shift();
    const page = CFI.toRange(this.doc, parts);
    if (!page) return 0;
    let low = 0;
    let high = this.nodes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const { node } = this.nodes[middle]!;
      const before = page.comparePoint(node, node.length) < 0;
      if (before) low = middle + 1;
      else high = middle;
    }
    const found = this.nodes[low];
    if (!found) return this.text.length;
    if (found.node !== page.startContainer) return found.start;
    const read = found.node.data.slice(0, page.startOffset).replace(/\s+/g, ' ');
    return found.start + Math.max(0, read.length - (found.trimmed ? 1 : 0));
  }
}

// The section being read is asked for again on every page turn.
let last: { bookDoc: BookDoc; index: number; section: SectionText } | null = null;

export const loadSection = async (bookDoc: BookDoc, index: number): Promise<SectionText> => {
  if (last?.bookDoc === bookDoc && last.index === index) return last.section;
  const { cfi, createDocument } = bookDoc.sections[index]!;
  const section = new SectionText(
    await createDocument.call(bookDoc.sections[index]),
    cfi ?? CFI.fake.fromIndex(index),
  );
  last = { bookDoc, index, section };
  return section;
};

/** Whether what ends at `endCfi` was read before the page at `location`. */
export const isRead = (endCfi: string, location: string) => CFI.compare(endCfi, location) <= 0;

/** The sections up to the page at `location`, and where in the last one it starts. */
export async function* readSections(
  bookDoc: BookDoc,
  location: string,
  from = 0,
): AsyncGenerator<{ index: number; end: number; section: SectionText }> {
  const current = Math.min(XCFI.extractSpineIndex(location), bookDoc.sections.length - 1);
  for (let index = from; index <= current; index++) {
    if (bookDoc.sections[index]!.linear === 'no') continue;
    const section = await loadSection(bookDoc, index);
    const end = index === current ? section.offsetOf(location) : section.text.length;
    yield { index, end, section };
  }
}

/** A passage of about a page. */
export interface XRayPassage {
  /** Reading order across the book; leaves room for a section's characters. */
  position: number;
  text: string;
  cfiAt(offset: number): string;
}

const PASSAGE_CHARS = 1000;
const SECTION_CHARS = 100_000_000;

const passageEnd = (text: string, start: number, end: number): number => {
  const full = start + PASSAGE_CHARS;
  if (full >= end) return end;
  // Back to the last sentence end in the final fifth, else to a space.
  const tail = text.slice(full - PASSAGE_CHARS / 5, full);
  const cut = Math.max(...['. ', '? ', '! ', '” '].map((mark) => tail.lastIndexOf(mark) + 1));
  const back = cut > 0 ? cut : Math.max(...['。', '！', '？', ' '].map((m) => tail.lastIndexOf(m)));
  return back > 0 ? full - tail.length + back + 1 : full;
};

/** The passages after `position`, up to the page at `location`. */
export async function* readPassages(
  bookDoc: BookDoc,
  position: number,
  location: string,
): AsyncGenerator<XRayPassage> {
  const from = Math.max(0, Math.floor(position / SECTION_CHARS));
  for await (const { index, end, section } of readSections(bookDoc, location, from)) {
    let start = index === from ? Math.max(0, position % SECTION_CHARS) : 0;
    while (start < end) {
      const stop = passageEnd(section.text, start, end);
      const at = start;
      const text = section.text.slice(at, stop);
      start = stop;
      if (!text.trim()) continue;
      yield {
        position: index * SECTION_CHARS + stop,
        text,
        cfiAt: (offset) => section.cfiAt(at + offset),
      };
    }
  }
}
