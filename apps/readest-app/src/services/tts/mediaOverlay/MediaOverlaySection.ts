// One section's narration index: SMIL pars resolved against the live section
// document, grouped into blocks, ready to drive both playback and the timeline.
//
// Pars are the narration units, so they take the place foliate's sentence
// segmentation holds for synthesized speech. Because each par already names the
// element it narrates, marks and audio clips are 1:1 by construction and no
// text-to-audio alignment is needed anywhere.

import type { BookDoc } from '@/libs/document';
import type { TimelineSentence } from '../SectionTimeline';
import { parseSmil } from './parseSmil';

export interface NarrationPar {
  // Section-global ordinal; doubles as the SSML mark name. foliate restarts
  // mark names per block, but nothing downstream requires that, and unique
  // names let the client resolve a mark to its clip without tracking blocks.
  markName: string;
  blockIndex: number;
  // Range over the narrated element's contents, in the section document.
  range: Range;
  text: string;
  audioHref: string;
  clipBegin: number;
  clipEnd: number;
}

const SSML_NS = 'http://www.w3.org/2001/10/synthesis';

// Mirrors foliate's `blockTags` in tts.js (not exported), so paragraph-level
// navigation lands on the same units it would for synthesized speech.
const BLOCK_TAGS = new Set([
  'article',
  'aside',
  'audio',
  'blockquote',
  'caption',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'dd',
  'figure',
  'footer',
  'form',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'math',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'tr',
]);

// A whole-paragraph par is its own block; word- or phrase-level pars inside one
// paragraph share it, which is what makes word-by-word highlighting fall out of
// the recording's own granularity.
const blockAncestor = (el: Element): Element => {
  let node: Element | null = el;
  while (node) {
    if (BLOCK_TAGS.has(node.localName)) return node;
    node = node.parentElement;
  }
  return el.ownerDocument.body ?? el;
};

// A range over the element's TEXT, with both boundaries inside text nodes and
// surrounding whitespace excluded.
//
// Not `selectNodeContents(el)`: that puts both boundaries on the element itself,
// and foliate's getCFI then emits a degenerate range CFI whose start and end
// paths are identical (`...,/10[id],/10[id]`). Readest's TTS highlighter
// round-trips every range through a CFI before drawing, so such a range
// re-anchored to nothing and the highlight silently never painted. foliate's own
// TTS ranges come from its text walker and are always text-node-based; these
// have to match. Returns null for an element with no readable text (a narrated
// image), whose clip is still heard because a block plays as one span.
const textRangeOf = (doc: Document, el: Element): Range | null => {
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.trim()) continue;
    first ??= text;
    last = text;
  }
  if (!first || !last) return null;

  const startOffset = first.data.length - first.data.trimStart().length;
  const endOffset = last.data.trimEnd().length;
  const range = doc.createRange();
  range.setStart(first, startOffset);
  range.setEnd(last, endOffset);
  return range;
};

const escapeXML = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class MediaOverlaySection {
  readonly pars: NarrationPar[];
  readonly blocks: NarrationPar[][] = [];
  #lang: string;
  #byMark: Map<string, NarrationPar>;

  constructor(pars: NarrationPar[], lang: string) {
    this.pars = pars;
    this.#lang = lang || 'en';
    this.#byMark = new Map(pars.map((par) => [par.markName, par]));
    for (const par of pars) {
      (this.blocks[par.blockIndex] ??= []).push(par);
    }
  }

  get blockCount(): number {
    return this.blocks.length;
  }

  parByMark(markName: string): NarrationPar | undefined {
    return this.#byMark.get(markName);
  }

  // The pars a `speak()` call covers: from `markName` to the end of its block,
  // matching how foliate truncates a block's SSML at the resume mark.
  parsFrom(markName: string): NarrationPar[] {
    const par = this.#byMark.get(markName);
    if (!par) return [];
    const block = this.blocks[par.blockIndex]!;
    return block.slice(block.indexOf(par));
  }

  // SSML for one block, optionally truncated to start at `fromMark`. The text
  // is carried only so the controller's mark bookkeeping works unchanged — the
  // client speaks nothing, it plays the recording.
  ssmlForBlock(blockIndex: number, fromMark?: string | null): string | undefined {
    const block = this.blocks[blockIndex];
    if (!block?.length) return undefined;
    const start = fromMark ? block.findIndex((par) => par.markName === fromMark) : 0;
    const pars = start > 0 ? block.slice(start) : block;
    // No separator between pars: the text run following a <mark> is attributed
    // to that mark, so a joining space would end up inside the preceding mark's
    // text. Nothing synthesizes this SSML, so only the per-mark text matters.
    const body = pars.map((par) => `<mark name="${par.markName}"/>${escapeXML(par.text)}`).join('');
    return `<speak xmlns="${SSML_NS}" xml:lang="${this.#lang}">${body}</speak>`;
  }

  // Exact durations, so the scrubber and chapter time are the recording's own
  // rather than an estimate.
  timelineSentences(): TimelineSentence[] {
    return this.pars.map((par) => ({
      blockIndex: par.blockIndex,
      markName: par.markName,
      range: par.range,
      text: par.text,
      duration: par.clipEnd - par.clipBegin,
    }));
  }
}

export const loadMediaOverlaySection = async (
  book: BookDoc,
  sectionIndex: number,
  doc: Document,
  lang: string,
): Promise<MediaOverlaySection | null> => {
  const overlay = book.sections?.[sectionIndex]?.mediaOverlay;
  if (!overlay?.href || !book.loadText) return null;

  let xml: string | null = null;
  try {
    xml = await book.loadText(overlay.href);
  } catch (e) {
    console.warn('[TTS] failed to load media overlay', overlay.href, e);
    return null;
  }
  if (!xml) return null;

  const pars: NarrationPar[] = [];
  let blockIndex = -1;
  let lastBlockEl: Element | null = null;
  for (const smilPar of parseSmil(xml, overlay.href)) {
    const el = doc.getElementById(smilPar.textId);
    if (!el) continue;
    const range = textRangeOf(doc, el);
    if (!range) continue;
    const text = range.toString().trim();
    if (!text) continue;

    const blockEl = blockAncestor(el);
    if (blockEl !== lastBlockEl) {
      blockIndex += 1;
      lastBlockEl = blockEl;
    }
    pars.push({
      markName: String(pars.length),
      blockIndex,
      range,
      text,
      audioHref: smilPar.audioHref,
      clipBegin: smilPar.clipBegin,
      clipEnd: smilPar.clipEnd,
    });
  }

  if (!pars.length) return null;
  return new MediaOverlaySection(pars, lang);
};
