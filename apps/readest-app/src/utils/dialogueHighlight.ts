import { BookNote, BookSearchMatch, BookSearchResult, ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { getIndexFromCfi } from '@/utils/cfi';

export const DIALOGUE_SPAN_CLASS = 'readest-dialogue';
export const DIALOGUE_BLOCK_CLASS = 'readest-dialogue-block';

/** Background, text color and weight can each enable dialogue marking. */
export const isDialogueHighlightActive = (viewSettings: ViewSettings): boolean =>
  !!viewSettings.dialogueHighlight ||
  !!viewSettings.dialogueHighlightCustomTextColor ||
  viewSettings.dialogueHighlightWeight === 'slightly-heavier' ||
  viewSettings.dialogueHighlightWeight === 'bold';

// Paired quotation marks used for dialogue across CJK and Western books:
// Chinese “”/‘’, Japanese 「」/『』, French «», German „“ plus ASCII "".
// ASCII single quotes are deliberately excluded: apostrophes in contractions
// (don't, it's) are indistinguishable from single-quote dialogue and would
// flood the page with false positives.
//
// Curly ‘’ is kept, but ’ is also the curly apostrophe, so a ’ between two
// letters (don’t, it’s) continues the quote instead of closing it. A
// word-final apostrophe (o’ rope, goin’ home, goin’—now, the lads’ boots)
// looks like a closing quote, so it continues the quote only when a ’ after
// punctuation other than a quote mark (it.’ / wet,’) closes it later in the same
// paragraph; otherwise the ’ after the word closes it as before (‘Hello’ she
// said).
//
// The scan runs over the section's concatenated text (not per text node), so
// a quote may span <br> and inline markup. A newline is inserted between
// blocks, and every pair except ASCII "" may cross it: ASCII quotes don't say
// which side they open, so a stray inch mark (5" screen) would otherwise flip
// the pairing and tint the narration instead of the dialogue.
//
// Each pair stops at its next opening mark (ASCII "" at the end of the block),
// so an unclosed quote can't swallow the next one. For ‘’, only a punctuated
// closing mark in the same paragraph allows a long quote. The looser fallback
// stays capped at 300 characters, since a mis-curled apostrophe (‘80s) opens a
// quote that nothing closes. Every quote is capped at MAX_QUOTE_LENGTH in case
// a malformed book pairs two marks pages apart.
const DIALOGUE_PATTERN =
  /“[^“”]+?[”"]|„[^„“]+?[“"]|"[^"\n]+?"|«[^«»]+?[»]|「[^「」]+?[」]|『[^『』]+?[』]|‘(?:[^‘’\n]|’(?=\p{L})|\p{L}’(?=[\s\p{Pd}]))*?(?![‘’“”„«»「」『』"'])\p{P}’(?!\p{L})|‘(?:[^‘’]|’(?=\p{L})){1,300}?’(?!\p{L})/gu;

// A quote holding inner quotes in the same marks (“my spiritual “children”;
// my dog”). Only within one paragraph: across paragraphs an opening mark
// with no close usually starts the next paragraph of a long speech, not a
// nested quote.
const NESTED_DIALOGUE_PATTERN =
  /“[^“”\n]*(?:“[^“”\n]*”[^“”\n]*)+”|„[^„“\n]*(?:„[^„“\n]*“[^„“\n]*)+“|«[^«»\n]*(?:«[^«»\n]*»[^«»\n]*)+»/gu;

// An unclosed quote may run to the end of its block when the next block
// starts with the same opening mark. Keep the existing closing-quote rules:
// only apostrophes within words are unambiguously part of a single quote.
const CONTINUED_DIALOGUE_PATTERN =
  /“[^“”"]+$|„[^„“"]+$|«[^«»]+$|「[^「」]+$|『[^『』]+$|‘(?:[^‘’]|’(?=\p{L}))+$/gu;

const MAX_QUOTE_LENGTH = 2048;
const SINGLE_QUOTE_FALLBACK_PATTERN = /‘(?:[^‘’]|’(?=\p{L})){1,300}?’(?!\p{L})/uy;

// Paragraph-leading dashes marking dialogue lines (French/Russian/CJK style).
// The ASCII hyphen is left out: it leads list items in converted text.
const DIALOGUE_DASH_RE = /^[—–―－][\s\u3000]/;

const SKIP_SELECTOR = 'pre, code, kbd, samp, script, style, textarea, rt, rp';

const isSkipped = (node: Text): boolean => {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest(`.${DIALOGUE_SPAN_CLASS}`)) return true;
  return !!parent.closest(SKIP_SELECTOR);
};

type TextEntry = { node: Text; start: number; end: number };
type Region = { start: number; end: number };
type TextBlock = Region & { firstCharacter: string; firstCharacterEligible: boolean };

const BLOCK_SELECTOR =
  'p, div, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, td, th, caption, figcaption, section, article, aside, body';

// Eligible text nodes in document order plus the concatenated section text.
// <br> and inline boundaries contribute zero characters, so a match range can
// transparently cross them and is mapped back to node slices below; a block
// boundary contributes a newline that belongs to no node.
const collectEntries = (
  doc: Document,
): { entries: TextEntry[]; text: string; blocks: TextBlock[] } => {
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, showText);
  const entries: TextEntry[] = [];
  const blocks: TextBlock[] = [];
  let text = '';
  let block: Element | null = null;
  let node = walker.nextNode() as Text | null;
  let textBlock: Element | null = null;
  while (node) {
    const content = node.textContent ?? '';
    if (content && !node.parentElement?.closest('script, style')) {
      const nodeBlock = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
      if (blocks.length === 0 || nodeBlock !== textBlock) {
        blocks.push({
          start: text.length,
          end: text.length,
          firstCharacter: '',
          firstCharacterEligible: false,
        });
      }
      textBlock = nodeBlock;
      const currentBlock = blocks[blocks.length - 1]!;
      const eligible = !isSkipped(node);
      if (!currentBlock.firstCharacter) {
        currentBlock.firstCharacter = content.trimStart().charAt(0);
        currentBlock.firstCharacterEligible = eligible;
      }
      if (eligible) {
        if (block && nodeBlock !== block) text += '\n';
        if (currentBlock.start === currentBlock.end) currentBlock.start = text.length;
        block = nodeBlock;
        entries.push({ node, start: text.length, end: text.length + content.length });
        text += content;
        currentBlock.end = text.length;
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return { entries, text, blocks };
};

const findRegions = (text: string, blocks: TextBlock[]): Region[] => {
  const raw: Region[] = [];
  // Whitespace between elements is not a paragraph. Include skipped text in
  // the leading character so code cannot hide narration before an opening mark.
  const paragraphs = blocks.filter((block) => block.firstCharacter);
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const block = paragraphs[i]!;
    const next = paragraphs[i + 1]!;
    const content = text.slice(block.start, block.end).trimEnd();
    CONTINUED_DIALOGUE_PATTERN.lastIndex = 0;
    const match = CONTINUED_DIALOGUE_PATTERN.exec(content);
    if (!match || !next.firstCharacterEligible || match[0][0] !== next.firstCharacter) continue;
    const limit = match[0][0] === '‘' ? 301 : MAX_QUOTE_LENGTH;
    if (match[0].length > limit) continue;
    raw.push({ start: block.start + match.index, end: block.start + content.length });
  }
  for (const pattern of [DIALOGUE_PATTERN, NESTED_DIALOGUE_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      // Too long: rescan from the next character, so quotes inside the
      // rejected span are still found.
      if (match[0].length > MAX_QUOTE_LENGTH) {
        pattern.lastIndex = match.index + 1;
        if (pattern === DIALOGUE_PATTERN && match[0][0] === '‘') {
          // The long alternative won before the loose fallback could run.
          SINGLE_QUOTE_FALLBACK_PATTERN.lastIndex = match.index;
          const fallback = SINGLE_QUOTE_FALLBACK_PATTERN.exec(text);
          if (fallback) {
            raw.push({ start: match.index, end: match.index + fallback[0].length });
            pattern.lastIndex = match.index + fallback[0].length;
          }
        }
        continue;
      }
      raw.push({ start: match.index, end: match.index + match[0].length });
    }
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
  // entries pointing at earlier offsets stay valid. Both lists are sorted, so
  // one cursor walks the entries once; an entry holding several quotes stays
  // under the cursor for each of them.
  let j = entries.length - 1;
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i]!;
    while (j >= 0 && entries[j]!.start >= region.end) j--;
    for (let k = j; k >= 0 && entries[k]!.end > region.start; k--) {
      const entry = entries[k]!;
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
  const { entries, text, blocks } = collectEntries(doc);
  if (entries.length === 0) return;
  wrapRegions(doc, entries, findRegions(text, blocks));
  markDashBlocks(doc);
};

// foliate-js keys its search highlights by this prefix (view.js SEARCH_PREFIX).
const SEARCH_PREFIX = 'foliate-search:';

/**
 * Re-run the marking on every section a view has rendered, e.g. after the
 * setting changes. Wrapping moves quoted text into spans, which collapses any
 * overlay range with an end inside a quote, so redraw the section's
 * highlights and search matches from their CFIs.
 */
export const refreshViewDialogueHighlight = (
  view: FoliateView,
  viewSettings: ViewSettings,
  booknotes: BookNote[],
  searchResults: BookSearchResult[] | BookSearchMatch[] | null = null,
): void => {
  const searchCfis = (searchResults ?? [])
    .flatMap((result) => ('subitems' in result ? result.subitems : [result]))
    .flatMap((match) => match.cfis ?? [match.cfi]);
  for (const { doc, index } of view.renderer.getContents()) {
    manageDialogueHighlight(doc, viewSettings);
    booknotes
      .filter(
        (note) =>
          note.type === 'annotation' &&
          note.style &&
          !note.deletedAt &&
          getIndexFromCfi(note.cfi) === index,
      )
      .forEach((note) => view.addAnnotation(note));
    searchCfis
      .filter((cfi) => getIndexFromCfi(cfi) === index)
      .forEach((cfi) =>
        view.addAnnotation({ value: SEARCH_PREFIX + cfi } as BookNote & { value: string }),
      );
  }
};
