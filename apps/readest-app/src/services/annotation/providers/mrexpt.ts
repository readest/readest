import * as CFI from 'foliate-js/epubcfi.js';
import { BookDoc, SectionItem } from '@/libs/document';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { collectAllTocItems } from '@/services/nav/grouping';
import { MrexptEntry } from '@/utils/mrexpt';

/**
 * Result of converting an mrexpt entry to a BookNote, including diagnostic
 * information that the caller can surface in toasts/dialogs.
 */
export interface MrexptConversionResult {
  /** Generated BookNotes ready to merge into the book config. */
  notes: BookNote[];
  /** Number of mrexpt entries that could not be located in the book. */
  unmatched: number;
  /** Total number of distinct mrexpt entries processed (after dedup). */
  total: number;
}

/**
 * Result of merging freshly-imported BookNotes into a book's existing notes.
 */
export interface MrexptMergeResult {
  /** The full, de-duplicated booknote list to persist. */
  merged: BookNote[];
  /** Notes added, resurrected, or updated this round — to redraw in views. */
  applied: BookNote[];
  /** Count of notes newly added or resurrected. */
  added: number;
  /** Count of existing notes updated with a newer copy. */
  updated: number;
}

/**
 * Merge imported BookNotes into a book's existing notes, deduplicating by id.
 *
 * - An unseen id is added.
 * - A previously soft-deleted note is resurrected (so re-importing the same
 *   file restores annotations the user had cleared).
 * - An existing note is updated only when the incoming copy is newer.
 * - An unchanged duplicate is left untouched and reported in neither count,
 *   so callers can reliably tell "nothing new" from "imported N".
 */
export const mergeImportedBookNotes = (
  existing: BookNote[],
  incoming: BookNote[],
): MrexptMergeResult => {
  const byId = new Map<string, BookNote>();
  for (const note of existing) byId.set(note.id, note);

  const applied: BookNote[] = [];
  let added = 0;
  let updated = 0;

  for (const note of incoming) {
    const prev = byId.get(note.id);
    if (!prev) {
      byId.set(note.id, note);
      added += 1;
      applied.push(note);
    } else if (prev.deletedAt) {
      const resurrected: BookNote = {
        ...prev,
        ...note,
        deletedAt: null,
        updatedAt: Date.now(),
      };
      byId.set(note.id, resurrected);
      added += 1;
      applied.push(resurrected);
    } else if (prev.updatedAt < note.updatedAt) {
      const merged: BookNote = { ...prev, ...note };
      byId.set(note.id, merged);
      updated += 1;
      applied.push(merged);
    }
  }

  return { merged: Array.from(byId.values()), applied, added, updated };
};

export interface MrexptConversionOptions {
  /**
   * Color used for plain highlights (Moon+ Reader's "highlight" color
   * doesn't map cleanly to Readest, so we pick a default).
   */
  highlightColor?: HighlightColor;
  /** Highlight style applied to all generated notes. */
  highlightStyle?: HighlightStyle;
  /**
   * Optional CFI factory. When provided, will be used in preference to
   * the built-in best-effort CFI generation. The factory receives the
   * spine index, section, document, and matched range.
   */
  cfiFactory?: (
    spineIndex: number,
    section: SectionItem,
    doc: Document,
    range: Range,
  ) => string | undefined;
}

/**
 * Build a fallback CFI string for a given spine index. Returns the section's
 * own CFI (form: `epubcfi(/6/4!)`) which foliate-js can resolve to the start
 * of the chapter. We deliberately don't try to invent an in-document path
 * like `/4/2/1:0` because that path is rarely valid for a real book and
 * would make `view.goTo()` fail to navigate.
 */
const buildFallbackSectionCfi = (spineIndex: number, section: SectionItem | undefined): string => {
  if (section?.cfi) return section.cfi;
  const step = 2 * (spineIndex + 1);
  return `epubcfi(/6/${step}!)`;
};

/**
 * Build a real, navigable CFI by combining the section's spine-step CFI
 * with the in-section path produced from the matched Range. This mirrors
 * what foliate-js's view.getCFI(index, range) does internally:
 *   CFI.joinIndir(sectionCfi, CFI.fromRange(range))
 * If anything goes wrong we fall back to the chapter-start CFI so the
 * note still lands on the right chapter, just not the exact word.
 */
const buildRangeCfi = (
  spineIndex: number,
  section: SectionItem,
  doc: Document,
  range: Range,
  factory?: MrexptConversionOptions['cfiFactory'],
): string => {
  const factoryResult = factory?.(spineIndex, section, doc, range);
  if (factoryResult) return factoryResult;
  if (section.cfi) {
    try {
      const rangeCfi = CFI.fromRange(range);
      if (rangeCfi) return CFI.joinIndir(section.cfi, rangeCfi);
    } catch (e) {
      console.warn('Failed to build range CFI for mrexpt entry:', e);
    }
  }
  return buildFallbackSectionCfi(spineIndex, section);
};

/**
 * Resolve a TOC href to its 0-based spine index by looking up the
 * corresponding SectionItem.
 *
 * BookDoc.splitTOCHref returns [sectionId, fragmentId?] where sectionId is
 * the path-resolved manifest item href (matching SectionItem.id).
 */
const buildHrefToSpineIndex = (bookDoc: BookDoc): Map<string, number> => {
  const map = new Map<string, number>();
  const sections = bookDoc.sections ?? [];
  sections.forEach((section, idx) => {
    if (section.id) map.set(section.id, idx);
    if (section.href) map.set(section.href, idx);
  });
  return map;
};

/**
 * Build a mapping from NCX navPoint 0-based index to spine index using
 * BookDoc.toc. The mrexpt format encodes the chapter as the navPoint index
 * (field b4), which corresponds to the in-document order of TOC items.
 */
const buildNavpointToSpine = (bookDoc: BookDoc): number[] => {
  const result: number[] = [];
  const hrefToSpine = buildHrefToSpineIndex(bookDoc);
  const flat = collectAllTocItems(bookDoc.toc ?? []);
  for (const item of flat) {
    if (!item.href) {
      result.push(-1);
      continue;
    }
    const [sectionId] = bookDoc.splitTOCHref(item.href) as [string | undefined];
    let spineIdx = -1;
    if (sectionId !== undefined) {
      spineIdx = hrefToSpine.get(sectionId) ?? -1;
    }
    if (spineIdx < 0) {
      // Try a basename match (some books store relative paths in TOC).
      const candidate = sectionId ?? item.href;
      const basename = candidate.split('/').pop() ?? candidate;
      const fallback = (bookDoc.sections ?? []).findIndex((s) => {
        const sid = s.id || s.href || '';
        return sid.endsWith(`/${basename}`) || sid === basename;
      });
      spineIdx = fallback;
    }
    result.push(spineIdx);
  }
  return result;
};

/**
 * Locate the first occurrence of `word` in a Document and return a Range
 * covering it. The match is case-insensitive; for ASCII words we keep a
 * trailing word boundary (so `cat` doesn't bleed into `category`) and a
 * tolerant leading boundary that also accepts a common English prefix —
 * this way Moon+ Reader entries like `happy` still locate words such as
 * `unhappy` or `dishappy` in the body text.
 *
 * For non-ASCII text (e.g. CJK) we fall back to a plain case-insensitive
 * substring search since regex word boundaries don't apply.
 */
const findWordRange = (doc: Document, word: string): Range | null => {
  if (!word) return null;
  const body = doc.body;
  if (!body) return null;

  const isAsciiWord = /^[A-Za-z][A-Za-z'-]*$/.test(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Common English prefixes that frequently attach to standalone words.
  // Order matters when patterns overlap (longest first) so the regex
  // engine prefers the longer, more specific prefix when both could
  // match (e.g. "under" before "un").
  const prefixGroup =
    '(?:under|over|trans|inter|super|extra|counter|semi|anti|pre|mis|non|dis|sub|out|up|re|un|in|im|il|ir|en|em)';
  // Common English suffixes (kept from the original implementation, plus a
  // few comparative/adverbial forms typical for adjectives).
  const suffixGroup = '(?:ly|y|ing|ed|d|es|s|er|est|ness|ment|ful|less|able|ible)';
  const pattern = isAsciiWord
    ? // Left side: either a real word boundary OR a known prefix that itself
      // sits at a word boundary. Right side: still requires a word boundary,
      // so we won't match the target inside an unrelated longer word.
      new RegExp(`(?:\\b|\\b${prefixGroup})${escaped}${suffixGroup}?\\b`, 'i')
    : new RegExp(escaped, 'i');

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = node.data;
    if (text) {
      const match = pattern.exec(text);
      if (match) {
        // Locate the actual start of `word` inside the match (the regex
        // also captures any leading prefix, so match.index points to the
        // prefix start). Highlight the original word, not the prefix.
        const wordStart = match[0].toLowerCase().lastIndexOf(word.toLowerCase());
        const start = wordStart >= 0 ? match.index + wordStart : match.index;
        const end = wordStart >= 0 ? start + word.length : match.index + match[0].length;
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range;
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return null;
};

const dedupeEntries = (entries: MrexptEntry[]): MrexptEntry[] => {
  const seen = new Set<string>();
  const out: MrexptEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.word.toLowerCase()}|${entry.note}|${entry.b4}|${entry.b6}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

const stableNoteId = (entry: MrexptEntry): string => {
  // Prefer a stable id derived from the entry so re-imports merge correctly.
  if (entry.entryId) return `mrexpt-${entry.entryId}`;
  return `mrexpt-${uniqueId()}`;
};

/**
 * Convert mrexpt entries to BookNote objects, locating each highlight inside
 * the BookDoc to obtain a real EPUB CFI. When the exact word cannot be found
 * we still emit a note pointing at the start of the chapter so the user
 * sees the import in the right place.
 */
export const convertMrexptEntriesToBookNotes = async (
  entries: MrexptEntry[],
  bookDoc: BookDoc,
  options: MrexptConversionOptions = {},
): Promise<MrexptConversionResult> => {
  const sections = bookDoc.sections ?? [];
  const navpointToSpine = buildNavpointToSpine(bookDoc);
  const highlightStyle = options.highlightStyle ?? 'highlight';
  const highlightColor = options.highlightColor ?? 'yellow';

  const unique = dedupeEntries(entries);
  const notes: BookNote[] = [];
  let unmatched = 0;
  const now = Date.now();

  // Cache section documents so we don't reparse them per word.
  const docCache = new Map<number, Document | null>();
  const loadSectionDoc = async (idx: number): Promise<Document | null> => {
    if (docCache.has(idx)) return docCache.get(idx) ?? null;
    const section = sections[idx];
    if (!section?.createDocument) {
      docCache.set(idx, null);
      return null;
    }
    try {
      const doc = await section.createDocument();
      docCache.set(idx, doc);
      return doc;
    } catch {
      docCache.set(idx, null);
      return null;
    }
  };

  for (let i = 0; i < unique.length; i++) {
    const entry = unique[i]!;
    const createdAt = entry.timestamp || now + i;

    let resolvedSpineIdx = -1;
    let resolvedRange: Range | null = null;
    let resolvedDoc: Document | null = null;

    // Strategy 1: use b4 (navPoint index) -> spine index mapping.
    if (entry.b4 >= 0 && entry.b4 < navpointToSpine.length) {
      const spineIdx = navpointToSpine[entry.b4]!;
      if (spineIdx >= 0 && spineIdx < sections.length) {
        const doc = await loadSectionDoc(spineIdx);
        if (doc) {
          const range = findWordRange(doc, entry.word);
          if (range) {
            resolvedSpineIdx = spineIdx;
            resolvedRange = range;
            resolvedDoc = doc;
          } else {
            // Section located but word not found — still anchor at chapter.
            resolvedSpineIdx = spineIdx;
          }
        }
      }
    }

    // Strategy 2: scan all sections in order if we still don't have a hit.
    if (!resolvedRange) {
      for (let s = 0; s < sections.length; s++) {
        if (s === resolvedSpineIdx) continue;
        const doc = await loadSectionDoc(s);
        if (!doc) continue;
        const range = findWordRange(doc, entry.word);
        if (range) {
          resolvedSpineIdx = s;
          resolvedRange = range;
          resolvedDoc = doc;
          break;
        }
      }
    }

    if (resolvedSpineIdx < 0) {
      unmatched += 1;
      continue;
    }

    const section = sections[resolvedSpineIdx]!;
    const cfi =
      resolvedRange && resolvedDoc
        ? buildRangeCfi(resolvedSpineIdx, section, resolvedDoc, resolvedRange, options.cfiFactory)
        : buildFallbackSectionCfi(resolvedSpineIdx, section);

    if (!resolvedRange) unmatched += 1;

    const note: BookNote = {
      id: stableNoteId(entry),
      type: 'annotation',
      cfi,
      text: entry.word,
      style: highlightStyle,
      color: highlightColor,
      note: entry.note,
      createdAt,
      updatedAt: createdAt,
    };
    notes.push(note);
  }

  return { notes, unmatched, total: unique.length };
};
