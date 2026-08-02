import * as CFI from 'foliate-js/epubcfi.js';
import { BookDoc, SectionItem } from '@/libs/document';
import {
  BookFormat,
  BookNote,
  BookNoteType,
  BooknoteGroup,
  HighlightColor,
  HighlightStyle,
} from '@/types/book';

/** Magic marker so an import can tell our own file from any other JSON. */
export const READEST_ANNOTATION_FORMAT = 'readest-annotations';
export const READEST_ANNOTATION_VERSION = 1;

const BOOK_NOTE_TYPES: BookNoteType[] = ['annotation', 'bookmark', 'excerpt'];

/**
 * One exported annotation. Field names mirror {@link BookNote} so the file
 * round-trips without a mapping layer. Per-install fields (`bookHash`,
 * `metaHash`, `deletedAt`) and derived ones (`page`) are deliberately absent.
 */
export interface ReadestAnnotationEntry {
  id: string;
  type: BookNoteType;
  cfi: string;
  text?: string;
  style?: HighlightStyle;
  color?: HighlightColor;
  note: string;
  global?: boolean;
  xpointer0?: string;
  xpointer1?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReadestAnnotationBook {
  title: string;
  author: string;
  hash?: string;
  metaHash?: string;
  format?: BookFormat;
}

export interface ReadestAnnotationExport {
  $format: typeof READEST_ANNOTATION_FORMAT;
  version: number;
  exportedAt: number;
  book: ReadestAnnotationBook;
  progress?: [number, number];
  location?: string;
  annotations: ReadestAnnotationEntry[];
}

export interface BuildAnnotationExportParams {
  book: ReadestAnnotationBook;
  /** Chapter groups, already filtered by the export dialog's color/style rules. */
  groups: BooknoteGroup[];
  progress?: [number, number];
  location?: string;
  exportedAt: number;
}

/** Serialize the (already filtered) booknote groups into the export envelope. */
export const buildAnnotationExport = ({
  book,
  groups,
  progress,
  location,
  exportedAt,
}: BuildAnnotationExportParams): ReadestAnnotationExport => {
  const annotations: ReadestAnnotationEntry[] = [];
  for (const group of groups) {
    for (const note of group.booknotes) {
      if (note.deletedAt) continue;
      const entry: ReadestAnnotationEntry = {
        id: note.id,
        type: note.type,
        cfi: note.cfi,
        note: note.note ?? '',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
      if (note.text) entry.text = note.text;
      if (note.style) entry.style = note.style;
      if (note.color) entry.color = note.color;
      if (note.global) entry.global = true;
      if (note.xpointer0) entry.xpointer0 = note.xpointer0;
      if (note.xpointer1) entry.xpointer1 = note.xpointer1;
      annotations.push(entry);
    }
  }

  const payload: ReadestAnnotationExport = {
    $format: READEST_ANNOTATION_FORMAT,
    version: READEST_ANNOTATION_VERSION,
    exportedAt,
    book,
    annotations,
  };
  if (progress) payload.progress = progress;
  if (location) payload.location = location;
  return payload;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const parseEntry = (value: unknown): ReadestAnnotationEntry | null => {
  if (!isRecord(value)) return null;
  const id = asString(value['id']);
  const cfi = asString(value['cfi']);
  const type = value['type'] as BookNoteType;
  if (!id || !cfi || !BOOK_NOTE_TYPES.includes(type)) return null;

  const entry: ReadestAnnotationEntry = {
    id,
    type,
    cfi,
    note: typeof value['note'] === 'string' ? value['note'] : '',
    createdAt: typeof value['createdAt'] === 'number' ? value['createdAt'] : 0,
    updatedAt: typeof value['updatedAt'] === 'number' ? value['updatedAt'] : 0,
  };
  const text = asString(value['text']);
  const style = asString(value['style']);
  const color = asString(value['color']);
  const xpointer0 = asString(value['xpointer0']);
  const xpointer1 = asString(value['xpointer1']);
  if (text) entry.text = text;
  if (style) entry.style = style as HighlightStyle;
  if (color) entry.color = color;
  if (value['global'] === true) entry.global = true;
  if (xpointer0) entry.xpointer0 = xpointer0;
  if (xpointer1) entry.xpointer1 = xpointer1;
  return entry;
};

/**
 * Validate and normalize a Readest annotations file. Returns null when the
 * envelope isn't ours; individual malformed entries are dropped instead.
 */
export const parseAnnotationExport = (json: string): ReadestAnnotationExport | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed['$format'] !== READEST_ANNOTATION_FORMAT) return null;
  if (!Array.isArray(parsed['annotations'])) return null;

  const book = isRecord(parsed['book']) ? parsed['book'] : {};
  const progress = parsed['progress'];
  const result: ReadestAnnotationExport = {
    $format: READEST_ANNOTATION_FORMAT,
    version: typeof parsed['version'] === 'number' ? parsed['version'] : READEST_ANNOTATION_VERSION,
    exportedAt: typeof parsed['exportedAt'] === 'number' ? parsed['exportedAt'] : 0,
    book: {
      title: asString(book['title']) ?? '',
      author: asString(book['author']) ?? '',
    },
    annotations: parsed['annotations']
      .map(parseEntry)
      .filter((entry): entry is ReadestAnnotationEntry => entry !== null),
  };
  const hash = asString(book['hash']);
  const metaHash = asString(book['metaHash']);
  const format = asString(book['format']);
  const location = asString(parsed['location']);
  if (hash) result.book.hash = hash;
  if (metaHash) result.book.metaHash = metaHash;
  if (format) result.book.format = format as BookFormat;
  if (
    Array.isArray(progress) &&
    progress.length === 2 &&
    progress.every((n) => typeof n === 'number')
  ) {
    result.progress = [progress[0] as number, progress[1] as number];
  }
  if (location) result.location = location;
  return result;
};

export interface ReadestConversionResult {
  /** Notes that found a home in this book, ready to merge into the config. */
  notes: BookNote[];
  /** Notes whose text had moved and were re-anchored to a new CFI. */
  reanchored: number;
  /** Entries dropped because neither the CFI nor a text search located them. */
  unmatched: number;
  /** Total entries processed. */
  total: number;
}

/**
 * Collapse whitespace runs and normalize Unicode so a highlight still compares
 * equal after a re-export reflowed the source markup.
 */
const normalizeText = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim();

interface ResolvedCfi {
  index: number;
  anchor?: (doc: Document) => Range | number;
}

/**
 * Map a CFI to its spine index plus an anchor factory. EPUB books resolve
 * through the book's own OPF-aware implementation; other formats fall back to
 * the fake-CFI scheme foliate-js generates from the spine index (mirrors
 * `view.resolveCFI`).
 */
const resolveCfi = (bookDoc: BookDoc, cfi: string): ResolvedCfi | null => {
  try {
    if (bookDoc.resolveCFI) return bookDoc.resolveCFI(cfi);
    const parts = CFI.parse(cfi);
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
    if (!Number.isInteger(index) || index < 0) return null;
    return { index, anchor: (doc: Document) => CFI.toRange(doc, parts) };
  } catch {
    return null;
  }
};

/** Turn a matched Range into the indirect CFI the reader stores. */
const buildCfi = (section: SectionItem, range: Range): string | null => {
  try {
    const rangeCfi = CFI.fromRange(range);
    if (!rangeCfi) return null;
    return CFI.joinIndir(section.cfi ?? CFI.fake.fromIndex(0), rangeCfi);
  } catch {
    return null;
  }
};

type SectionMatcher = (doc: Document, query: string) => Iterable<{ range: Range }>;

/**
 * Exact, case-sensitive text search reusing foliate-js's own matcher so a
 * highlight spanning several elements is found the same way the reader's
 * in-book search finds it.
 */
const loadMatcher = async (): Promise<SectionMatcher> => {
  const [{ searchMatcher }, { textWalker }] = await Promise.all([
    import('foliate-js/search.js'),
    import('foliate-js/text-walker.js'),
  ]);
  return searchMatcher(textWalker, {
    mode: 'contains',
    matchCase: true,
    matchDiacritics: true,
  }) as SectionMatcher;
};

export interface ReadestConversionOptions {
  /** Yield to the event loop every N entries so an import spinner keeps painting. */
  yieldEvery?: number;
}

/**
 * Turn an exported payload into BookNotes anchored in `bookDoc`.
 *
 * For each entry with text we require the stored CFI to resolve *and* the text
 * it covers to equal the exported text; anything else falls through to a
 * whole-book text search that re-anchors the note to where the text lives now.
 * Bookmarks carry no text, so resolvability is the only test. Entries that
 * neither path can place are dropped and counted in `unmatched`.
 */
export const convertAnnotationExportToBookNotes = async (
  payload: ReadestAnnotationExport,
  bookDoc: BookDoc,
  options: ReadestConversionOptions = {},
): Promise<ReadestConversionResult> => {
  const sections = bookDoc.sections ?? [];
  const entries = payload.annotations ?? [];
  const yieldEvery = options.yieldEvery ?? 5;

  const docCache = new Map<number, Document | null>();
  const loadSectionDoc = async (index: number): Promise<Document | null> => {
    if (docCache.has(index)) return docCache.get(index) ?? null;
    const section = sections[index];
    if (!section?.createDocument) {
      docCache.set(index, null);
      return null;
    }
    try {
      const doc = await section.createDocument();
      docCache.set(index, doc);
      return doc;
    } catch {
      docCache.set(index, null);
      return null;
    }
  };

  /** Range the stored CFI covers, or null if it doesn't resolve in this book. */
  const rangeFromCfi = async (cfi: string): Promise<Range | null> => {
    const resolved = resolveCfi(bookDoc, cfi);
    if (!resolved || resolved.index < 0 || resolved.index >= sections.length) return null;
    const doc = await loadSectionDoc(resolved.index);
    if (!doc || !resolved.anchor) return null;
    try {
      const anchored = resolved.anchor(doc);
      return typeof anchored === 'number' ? null : anchored;
    } catch {
      return null;
    }
  };

  let matcher: SectionMatcher | null = null;
  /** First occurrence of `text` anywhere in the book, as a fresh CFI. */
  const searchForText = async (text: string): Promise<string | null> => {
    matcher ??= await loadMatcher();
    for (let index = 0; index < sections.length; index++) {
      const doc = await loadSectionDoc(index);
      if (!doc) continue;
      try {
        for (const match of matcher(doc, text)) {
          const cfi = buildCfi(sections[index]!, match.range);
          if (cfi) return cfi;
        }
      } catch (error) {
        console.warn('Failed to search section for imported annotation:', error);
      }
    }
    return null;
  };

  const notes: BookNote[] = [];
  let reanchored = 0;
  let unmatched = 0;

  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && i % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const entry = entries[i]!;
    // Only a real highlighted range asserts its own text. A bookmark's `text`
    // is a display snippet of the surrounding paragraph: routinely truncated,
    // sometimes a chapter label rather than book text, and its CFI is often a
    // collapsed point covering no text at all. Comparing it would drop or
    // relocate perfectly good bookmarks, so a bookmark is judged purely on
    // whether its CFI still resolves.
    const expected = entry.type !== 'bookmark' && entry.text ? normalizeText(entry.text) : '';

    const range = await rangeFromCfi(entry.cfi);
    const matchesText = !!range && !!expected && normalizeText(range.toString()) === expected;

    let cfi: string | null = null;
    let moved = false;
    if (matchesText || (!expected && range)) {
      // Exact hit, or a bookmark whose CFI still lands somewhere valid.
      cfi = entry.cfi;
    } else if (expected) {
      cfi = await searchForText(entry.text!);
      moved = !!cfi;
    }

    if (!cfi) {
      unmatched += 1;
      continue;
    }
    if (moved) reanchored += 1;

    const note: BookNote = {
      id: entry.id,
      type: entry.type,
      cfi,
      note: entry.note ?? '',
      createdAt: entry.createdAt || Date.now(),
      updatedAt: entry.updatedAt || entry.createdAt || Date.now(),
    };
    if (entry.text) note.text = entry.text;
    if (entry.style) note.style = entry.style;
    if (entry.color) note.color = entry.color;
    if (entry.global) note.global = true;
    // XPointers describe the *old* book's DOM; they're only still true when we
    // kept the original CFI.
    if (!moved) {
      if (entry.xpointer0) note.xpointer0 = entry.xpointer0;
      if (entry.xpointer1) note.xpointer1 = entry.xpointer1;
    }
    notes.push(note);
  }

  return { notes, reanchored, unmatched, total: entries.length };
};
