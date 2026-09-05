import * as CFI from 'foliate-js/epubcfi.js';
import { BookDoc, SectionItem } from '@/libs/document';
import { BookNote, HighlightColor } from '@/types/book';
import { XCFI } from '@/utils/xcfi';
import {
  ReadEraDoc,
  ReadEraNote,
  ReadEraPosition,
  normalizeReadEraXPointer,
} from '@/utils/readera';

export interface ReadEraConversionResult {
  /** Generated BookNotes ready to merge into the book config. */
  notes: BookNote[];
  /** Notes that could not be placed any better than the start of their chapter. */
  unmatched: number;
  /** Total number of ReadEra notes processed. */
  total: number;
  /** The reading position from the backup, as a CFI, when it could be resolved. */
  location?: string;
}

/**
 * ReadEra stores the highlight marker as an index into its own palette. The
 * palette order is not part of the backup, so this is a best-effort bijection
 * onto Readest's five colors: what matters is that two highlights the user
 * marked differently stay different after the import.
 */
const READERA_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red', 'violet'];

export const mapReadEraColor = (mark: number | undefined): HighlightColor =>
  (mark !== undefined && READERA_COLORS[mark]) || 'yellow';

/**
 * The 0-based section index a ReadEra locator points at:
 * - `/body/DocFragment[N]/...` is CREngine's 1-based spine fragment, so `N - 1`
 *   (see the note on section numbering in `utils/xcfi.ts`);
 * - `/page[N]/...` is MuPDF's 0-based page index, which is already the index of
 *   the matching foliate section for a fixed-layout book;
 * - a paged book's bookmarks, and most of its reading positions, carry no
 *   locator at all and only say which page they are on.
 *
 * A reflowable position always carries an XPointer, and its `page` is ReadEra's
 * own pagination, which says nothing about the spine: guessing a section from
 * it would repeat the percentage-drift mistake removed in #5980.
 */
const readEraSectionIndex = (position: ReadEraPosition | undefined, paged: boolean): number => {
  const xpath = position?.xPath;
  if (!xpath) return paged && position?.page !== undefined ? position.page : -1;
  const fragment = xpath.match(/^\/body\/DocFragment\[(\d+)\]/);
  if (fragment) return parseInt(fragment[1]!, 10) - 1;
  const page = xpath.match(/^\/page\[(\d+)\]/);
  if (page) return parseInt(page[1]!, 10);
  return -1;
};

/**
 * The CFI prefix a section's in-document paths hang off. EPUB sections carry
 * their own spine-step CFI; PDF (and other fixed-layout) sections have none, so
 * we synthesize the same `/6/{2(i+1)}` step foliate-js uses for them.
 */
const sectionBaseCfi = (index: number, section: SectionItem | undefined): string => {
  const cfi = section?.cfi;
  // Defensive: a section CFI is a plain spine step, but strip the indirection
  // marker if one ever shows up so joining doesn't produce `!!`.
  if (cfi) return cfi.replace(/!(\))?$/, '$1');
  return CFI.fake.fromIndex(index);
};

/** A CFI pointing at the very start of a section. */
const sectionStartCfi = (index: number, section: SectionItem | undefined): string =>
  CFI.joinIndir(sectionBaseCfi(index, section), '');

/**
 * Re-hang an in-document CFI path onto the section's real spine step. `XCFI`
 * always emits `/6/{2(i+1)}`, which only matches books whose spine itemrefs are
 * the package document's only relevant children.
 */
const rebaseOntoSection = (cfi: string, base: string): string => {
  const inner = cfi.match(/^epubcfi\((.*)\)$/)?.[1];
  if (!inner) return cfi;
  const indirection = inner.indexOf('!');
  return CFI.joinIndir(base, indirection >= 0 ? inner.slice(indirection + 1) : inner);
};

interface TextPosition {
  node: Text;
  offset: number;
}

const collectTextNodes = (doc: Document): Text[] => {
  const body = doc.body;
  if (!body) return [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const tag = node.parentElement?.tagName.toLowerCase();
      return tag === 'script' || tag === 'style'
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
};

/**
 * Flatten a document into one lowercased string with runs of whitespace
 * collapsed to a single space, keeping the source position of every character
 * so a match can be turned back into a Range.
 */
const buildHaystack = (nodes: Text[]): { text: string; positions: TextPosition[] } => {
  let text = '';
  const positions: TextPosition[] = [];
  let afterSpace = true;
  for (const node of nodes) {
    const data = node.data;
    for (let offset = 0; offset < data.length; offset++) {
      const char = data[offset]!;
      if (/\s/.test(char)) {
        if (afterSpace) continue;
        text += ' ';
        afterSpace = true;
      } else {
        text += char.toLowerCase();
        afterSpace = false;
      }
      positions.push({ node, offset });
    }
  }
  return { text, positions };
};

const normalizeNeedle = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Locate `text` in a section document and return the Range covering it.
 *
 * ReadEra copies the highlighted text with its own whitespace handling and the
 * match often spans several inline elements, so we search a whitespace-collapsed
 * flattening of the document rather than individual text nodes. Pass
 * `requireUnique` when the caller has a locator to fall back on.
 */
export const findReadEraTextRange = (
  doc: Document,
  text: string,
  requireUnique = false,
): Range | null => {
  const needle = normalizeNeedle(text);
  if (!needle) return null;
  const { text: haystack, positions } = buildHaystack(collectTextNodes(doc));
  const start = haystack.indexOf(needle);
  if (start < 0) return null;
  // A phrase that occurs more than once says nothing about which occurrence was
  // highlighted, so a note that carries a locator is better served by it.
  if (requireUnique && haystack.indexOf(needle, start + 1) >= 0) return null;
  const first = positions[start];
  const last = positions[start + needle.length - 1];
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
};

/** Convert a ReadEra XPointer pair into a CFI within `section`. */
const cfiFromXPointer = (
  position: ReadEraPosition | undefined,
  index: number,
  section: SectionItem | undefined,
  doc: Document,
): string | null => {
  const xPath = position?.xPath;
  if (!xPath || !xPath.startsWith('/body/DocFragment[')) return null;
  try {
    const converter = new XCFI(doc, index);
    const xPathEnd = position?.xPathEnd;
    const cfi = converter.xPointerToCFI(
      normalizeReadEraXPointer(xPath),
      xPathEnd ? normalizeReadEraXPointer(xPathEnd) : undefined,
    );
    return rebaseOntoSection(cfi, sectionBaseCfi(index, section));
  } catch {
    return null;
  }
};

/**
 * Convert one ReadEra document's highlights, bookmarks and reading position
 * into Readest BookNotes.
 *
 * A highlight is anchored by searching the section for the text ReadEra saved
 * with it, which survives a different edition of the same book. When that
 * fails we fall back to the CREngine XPointer, and finally to the start of the
 * section so the note is at least in the right chapter.
 */
export const convertReadEraDocToBookNotes = async (
  readEraDoc: ReadEraDoc,
  bookDoc: BookDoc,
): Promise<ReadEraConversionResult> => {
  const sections = bookDoc.sections ?? [];
  // Fixed-layout sections are pages and carry no spine CFI of their own.
  const paged = sections.length > 0 && !sections.some((section) => section.cfi);
  const notes: BookNote[] = [];
  let unmatched = 0;

  const docCache = new Map<number, Document | null>();
  const loadSectionDoc = async (index: number): Promise<Document | null> => {
    if (docCache.has(index)) return docCache.get(index) ?? null;
    let doc: Document | null = null;
    try {
      doc = (await sections[index]?.createDocument()) ?? null;
    } catch {
      doc = null;
    }
    docCache.set(index, doc);
    return doc;
  };

  const entries: Array<{ note: ReadEraNote; type: 'annotation' | 'bookmark' }> = [
    ...readEraDoc.citations.map((note) => ({ note, type: 'annotation' as const })),
    ...readEraDoc.bookmarks.map((note) => ({ note, type: 'bookmark' as const })),
  ];

  // Yield to the event loop every few notes so the UI stays responsive during
  // a large import; parsing section documents is synchronous and expensive.
  const YIELD_EVERY = 5;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && i % YIELD_EVERY === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const { note, type } = entries[i]!;
    const index = readEraSectionIndex(note.position, paged);
    if (index < 0 || index >= sections.length) {
      unmatched += 1;
      continue;
    }
    const doc = await loadSectionDoc(index);
    if (!doc) {
      unmatched += 1;
      continue;
    }
    const section = sections[index];

    let cfi: string | null = null;
    if (type === 'annotation') {
      const range = findReadEraTextRange(doc, note.body, Boolean(note.position?.xPath));
      if (range) {
        try {
          const rangeCfi = CFI.fromRange(range);
          if (rangeCfi) cfi = rebaseOntoSection(rangeCfi, sectionBaseCfi(index, section));
        } catch (error) {
          console.warn('Failed to build range CFI for ReadEra note:', error);
        }
      }
    }
    if (!cfi) cfi = cfiFromXPointer(note.position, index, section, doc);
    if (!cfi) {
      cfi = sectionStartCfi(index, section);
      // A page-only locator has no finer anchor to lose: the page it named is
      // exactly where it pointed.
      if (note.position?.xPath) unmatched += 1;
    }

    notes.push({
      id: `readera-${note.uri}`,
      type,
      cfi,
      text: note.body,
      note: note.note,
      ...(type === 'annotation'
        ? { style: 'highlight' as const, color: mapReadEraColor(note.mark) }
        : {}),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  }

  let location: string | undefined;
  const positionIndex = readEraSectionIndex(readEraDoc.position, paged);
  if (positionIndex >= 0 && positionIndex < sections.length) {
    const section = sections[positionIndex];
    const doc = await loadSectionDoc(positionIndex);
    if (doc) {
      location = cfiFromXPointer(readEraDoc.position, positionIndex, section, doc) ?? undefined;
    }
    // A paged locator resolves no finer than the page it names, so the page
    // start loses nothing. A reflowable XPointer that failed to resolve must
    // not fall back to the chapter start, per the #5980 rule.
    const reflowable = readEraDoc.position?.xPath?.startsWith('/body/DocFragment[');
    location ??= reflowable ? undefined : sectionStartCfi(positionIndex, section);
  }

  return { notes, unmatched, total: entries.length, location };
};
