import { ViewSettings } from '@/types/book';

export const DIALOGUE_SPAN_CLASS = 'readest-dialogue';
export const DIALOGUE_BLOCK_CLASS = 'readest-dialogue-block';

/**
 * Whether dialogue marking is active at all. Background and text are
 * independent: text coloring keeps working with the background off, so the
 * section must be wrapped (and styled) when either switch is on.
 */
export const isDialogueHighlightActive = (viewSettings: ViewSettings): boolean =>
  !!viewSettings.dialogueHighlight || !!viewSettings.dialogueHighlightCustomTextColor;

// Paired quotation marks used for dialogue across CJK and Western books:
// Chinese “”/‘’, Japanese 「」/『』, French «», German „“ plus ASCII "".
// ASCII single quotes are deliberately excluded: apostrophes in contractions
// (don't, it's) are indistinguishable from single-quote dialogue and would
// flood the page with false positives.
//
// The scan runs over the section's concatenated text (not per text node), so
// a quote may span line breaks, <br> and inline markup. Newlines are allowed
// inside every pair except ASCII "": a stray inch mark (5" screen) would
// otherwise tint everything up to the next quote, while CJK books never use
// " for inches.
const DIALOGUE_PATTERN =
  /“[^“”]{1,500}?[”"]|„[^„“]{1,500}?[“"]|"[^"\n]{1,500}?"|«[^«»]{1,500}?[»]|「[^「」]{1,500}?[」]|『[^『』]{1,500}?[』]|‘[^‘’]{1,300}?[’]/g;

// Paragraph-leading dashes marking dialogue lines (French/Russian/CJK style).
const DIALOGUE_DASH_RE = /^[—–―－-][\s\u3000]/;

const SKIP_SELECTOR = 'pre, code, kbd, samp, script, style, textarea, rt, rp';

const isSkipped = (node: Text): boolean => {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest(`.${DIALOGUE_SPAN_CLASS}`)) return true;
  return !!parent.closest(SKIP_SELECTOR);
};

type TextEntry = { node: Text; start: number; end: number };

// Eligible text nodes in document order plus the concatenated section text.
// <br> and element boundaries contribute zero characters, so a match range
// can transparently cross them and is mapped back to node slices below.
const collectEntries = (doc: Document): { entries: TextEntry[]; text: string } => {
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, showText);
  const entries: TextEntry[] = [];
  let text = '';
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (!isSkipped(node)) {
      const content = node.textContent ?? '';
      if (content) {
        entries.push({ node, start: text.length, end: text.length + content.length });
        text += content;
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return { entries, text };
};

type Region = { start: number; end: number };

const findRegions = (text: string): Region[] => {
  DIALOGUE_PATTERN.lastIndex = 0;
  const raw: Region[] = [];
  let match: RegExpExecArray | null;
  while ((match = DIALOGUE_PATTERN.exec(text))) {
    raw.push({ start: match.index, end: match.index + match[0].length });
  }
  // Drop nested/overlapping regions, keeping the outermost-earliest: the tint
  // is identical, so one span covering both is enough.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const regions: Region[] = [];
  let lastEnd = -1;
  for (const region of raw) {
    if (region.start >= lastEnd) {
      regions.push(region);
      lastEnd = region.end;
    }
  }
  return regions;
};

const wrapSlice = (doc: Document, node: Text, start: number, end: number): void => {
  if (start >= end) return;
  if (end < node.length) node.splitText(end);
  const target = start > 0 ? node.splitText(start) : node;
  const span = doc.createElement('span');
  span.className = DIALOGUE_SPAN_CLASS;
  // CFI-transparent like the translation/ruby wrappers: the span contributes
  // no CFI step, so saved locations resolve identically with or without marks.
  span.setAttribute('cfi-skip', '');
  target.parentNode?.replaceChild(span, target);
  span.appendChild(target);
};

const wrapRegions = (doc: Document, entries: TextEntry[], regions: Region[]): void => {
  // Back to front: splitting a node only detaches its trailing part, so
  // entries pointing at earlier offsets stay valid.
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i]!;
    for (const entry of entries) {
      if (entry.end <= region.start || entry.start >= region.end) continue;
      if (!entry.node.isConnected) continue;
      wrapSlice(
        doc,
        entry.node,
        Math.max(region.start, entry.start) - entry.start,
        Math.min(region.end, entry.end) - entry.start,
      );
    }
  }
};

const DIALOGUE_BLOCK_SELECTOR = 'p, li, blockquote, dd, dt';

const markDashBlocks = (doc: Document): void => {
  // div is excluded: books routinely wrap whole chapters in divs, so a
  // chapter-opening dialogue line would tint the entire chapter.
  const matched = [...doc.querySelectorAll(DIALOGUE_BLOCK_SELECTOR)].filter((el) =>
    DIALOGUE_DASH_RE.test((el.textContent ?? '').trimStart()),
  );
  const matchedSet = new Set(matched);
  // Innermost only: an ancestor shares its leading text with its first block
  // descendant, so marking both would stack two translucent tints.
  matched.forEach((el) => {
    const hasMatchedDescendant = [...el.querySelectorAll(DIALOGUE_BLOCK_SELECTOR)].some((d) =>
      matchedSet.has(d),
    );
    if (!hasMatchedDescendant) el.classList.add(DIALOGUE_BLOCK_CLASS);
  });
};

/** Remove all dialogue marks without touching anything else. */
export const clearDialogueHighlight = (doc: Document): void => {
  doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).forEach((el) => {
    // Move children out in order instead of flattening to text: a span may
    // wrap Word Lens ruby or other inline markup that must survive.
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`).forEach((el) => {
    el.classList.remove(DIALOGUE_BLOCK_CLASS);
  });
  // Merge the text nodes split by wrapRegions so repeated toggles and CFI
  // resolution see the original text-node layout again.
  (doc.body ?? doc.documentElement)?.normalize();
};

/**
 * Wrap quoted dialogue in spans (and mark dash-led paragraphs) so the
 * `.readest-dialogue` CSS from getStyles can tint them with the theme's
 * primary color. No-op when disabled; idempotent via clear-first.
 */
export const manageDialogueHighlight = (doc: Document, viewSettings: ViewSettings): void => {
  clearDialogueHighlight(doc);
  if (!isDialogueHighlightActive(viewSettings)) return;
  if (!doc.body && !doc.documentElement) return;
  const { entries, text } = collectEntries(doc);
  if (entries.length === 0) return;
  wrapRegions(doc, entries, findRegions(text));
  markDashBlocks(doc);
};
