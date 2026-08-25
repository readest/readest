import type { BookDoc, TOCItem } from '@/libs/document';
import { collectAudiobookTextChapters } from '@/services/audiobook/mapping';
import type { AudiobookChapter, AudiobookFile, PairedAudiobook } from '@/types/book';
import { MediaOverlaySection, type NarrationPar } from './mediaOverlay/MediaOverlaySection';

interface PairedChapterEntry {
  tocItems: TOCItem[];
  sectionIndex: number;
  audioChapter: AudiobookChapter;
  audioFile: AudiobookFile;
  clipBegin: number;
  clipEnd: number;
}

interface PairedChapterCandidate
  extends Omit<PairedChapterEntry, 'tocItems' | 'clipBegin' | 'clipEnd'> {
  tocItem: TOCItem;
  orderIndex: number;
}

interface TextPoint {
  node: Text;
  offset: number;
}

const sectionIndexForHref = (book: BookDoc, href: string): number => {
  const [sectionId] = book.splitTOCHref(href) as [string | undefined];
  if (!sectionId) return -1;
  return book.sections.findIndex(
    (section) => section.id === sectionId || section.href === sectionId,
  );
};

// The recording a mapped audio chapter owns: its own span plus the unmapped
// chapters that follow it in the same file, up to the next mapped chapter.
// Audiobook chapter lists are routinely finer than the EPUB's TOC (1, 1.1,
// 1.2, 2 ...), and a sub-chapter nobody could map is still part of the chapter
// it follows; without this the recording skipped straight over it (#5863).
// Chapters before the first mapped one in a file have nothing to attach to and
// stay unplayed, as do gaps between chapters.
const mappedAudioSpans = (
  association: PairedAudiobook,
): Map<string, { start: number; end: number }> => {
  const mapped = new Set(association.mappings.map((mapping) => mapping.audioChapterId));
  const spans = new Map<string, { start: number; end: number }>();
  const ownerByFile = new Map<string, { start: number; end: number }>();
  for (const chapter of association.chapters) {
    if (mapped.has(chapter.id)) {
      const span = { start: chapter.start, end: chapter.end };
      spans.set(chapter.id, span);
      ownerByFile.set(chapter.fileId, span);
      continue;
    }
    const owner = ownerByFile.get(chapter.fileId);
    if (owner) owner.end = Math.max(owner.end, chapter.end);
  }
  return spans;
};

const pairedChapterEntries = (
  book: BookDoc,
  association: PairedAudiobook,
): PairedChapterEntry[] => {
  const tocByHref = new Map(
    collectAudiobookTextChapters(book.toc ?? []).map((chapter) => [chapter.href, chapter]),
  );
  const rawTocByHref = new Map<string, TOCItem>();
  const visit = (items: TOCItem[]) => {
    for (const item of items) {
      if (item.href && !rawTocByHref.has(item.href)) rawTocByHref.set(item.href, item);
      if (item.subitems?.length) visit(item.subitems);
    }
  };
  visit(book.toc ?? []);

  const chapterById = new Map(association.chapters.map((chapter) => [chapter.id, chapter]));
  const spans = mappedAudioSpans(association);
  const fileById = new Map(association.files.map((file) => [file.id, file]));
  const mappingByEbook = new Map(
    association.mappings.map((mapping) => [mapping.ebookChapterId, mapping.audioChapterId]),
  );
  const candidates: PairedChapterCandidate[] = [];

  for (const [orderIndex, { href }] of [...tocByHref.values()].entries()) {
    const audioChapterId = mappingByEbook.get(href);
    if (!audioChapterId) continue;
    const audioChapter = chapterById.get(audioChapterId);
    const audioFile = audioChapter ? fileById.get(audioChapter.fileId) : undefined;
    const tocItem = rawTocByHref.get(href);
    const sectionIndex = sectionIndexForHref(book, href);
    if (!audioChapter || !audioFile || !tocItem || sectionIndex < 0) continue;

    candidates.push({ tocItem, sectionIndex, audioChapter, audioFile, orderIndex });
  }

  const entries: PairedChapterEntry[] = [];
  for (let index = 0; index < candidates.length; ) {
    const first = candidates[index]!;
    let end = index + 1;
    while (
      end < candidates.length &&
      candidates[end]!.audioChapter.id === first.audioChapter.id &&
      candidates[end]!.orderIndex === candidates[end - 1]!.orderIndex + 1
    ) {
      end += 1;
    }

    const run = candidates.slice(index, end);
    const span = spans.get(first.audioChapter.id)!;
    const duration = span.end - span.start;
    for (const [runIndex, candidate] of run.entries()) {
      // A chapter-only pairing has no finer timing signal. Divide one reused
      // clip into equal chapter slices so a run can cross spine documents
      // without replaying the whole recording at every section boundary.
      const clipBegin = span.start + (duration * runIndex) / run.length;
      const clipEnd = span.start + (duration * (runIndex + 1)) / run.length;
      const previous = entries.at(-1);
      if (
        previous?.audioChapter.id === candidate.audioChapter.id &&
        previous.sectionIndex === candidate.sectionIndex &&
        runIndex > 0
      ) {
        previous.tocItems.push(candidate.tocItem);
        previous.clipEnd = clipEnd;
      } else {
        entries.push({
          tocItems: [candidate.tocItem],
          sectionIndex: candidate.sectionIndex,
          audioChapter: candidate.audioChapter,
          audioFile: candidate.audioFile,
          clipBegin,
          clipEnd,
        });
      }
    }
    index = end;
  }
  return entries;
};

const readableTextPoints = (root: Node): { first: TextPoint; last: TextPoint } | null => {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let first: TextPoint | null = null;
  let last: TextPoint | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.trim()) continue;
    first ??= { node: text, offset: text.data.length - text.data.trimStart().length };
    last = { node: text, offset: text.data.trimEnd().length };
  }
  return first && last ? { first, last } : null;
};

const fragmentId = (href: string): string | null => {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return null;
  const raw = href.slice(hashIndex + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const chapterStart = (doc: Document, href: string): TextPoint | null => {
  const id = fragmentId(href);
  if (!id) return doc.body ? (readableTextPoints(doc.body)?.first ?? null) : null;

  const root = doc.getElementById(id) ?? doc.getElementsByName(id).item(0);
  if (!root) return null;
  const point = readableTextPoints(root)?.first;
  if (point) return point;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.trim()) continue;
    if (root.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return { node: text, offset: text.data.length - text.data.trimStart().length };
    }
  }
  return null;
};

const chapterRange = (
  doc: Document,
  href: string,
  nextHrefInSection: string | undefined,
): Range | null => {
  const start = chapterStart(doc, href);
  const bodyPoints = doc.body ? readableTextPoints(doc.body) : null;
  if (!start || !bodyPoints) return null;
  const next = nextHrefInSection ? chapterStart(doc, nextHrefInSection) : null;
  const end = next ?? bodyPoints.last;
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
};

export interface NarratedAudioChapter {
  chapter: AudiobookChapter;
  // The file holding it, as NarrationPar.audioHref names it.
  audioHref: string;
  // The spine section whose narration plays it.
  sectionIndex: number;
}

// Every audio chapter playback can reach, in recording order. Unmapped
// chapters count when a mapped chapter's span absorbed them; the ones nothing
// owns are left out.
export const narratedAudioChapters = (
  book: BookDoc,
  association: PairedAudiobook,
): NarratedAudioChapter[] => {
  const entries = pairedChapterEntries(book, association);
  const fileById = new Map(association.files.map((file) => [file.id, file]));
  const chapters: NarratedAudioChapter[] = [];
  for (const chapter of association.chapters) {
    const audioHref = fileById.get(chapter.fileId)?.path;
    const entry = entries.find(
      (candidate) =>
        candidate.audioFile.path === audioHref &&
        candidate.clipBegin <= chapter.start &&
        chapter.start < candidate.clipEnd,
    );
    if (!audioHref || !entry) continue;
    chapters.push({ chapter, audioHref, sectionIndex: entry.sectionIndex });
  }
  return chapters;
};

// Backward this far into a chapter restarts it rather than leaving it, the
// convention every audiobook player follows.
const CHAPTER_RESTART_SEC = 3;

// Where a chapter skip lands from `seconds` into the file at `audioHref`.
export const adjacentAudioChapter = (
  chapters: NarratedAudioChapter[],
  audioHref: string,
  seconds: number,
  direction: 1 | -1,
): NarratedAudioChapter | null => {
  let current = -1;
  for (const [index, entry] of chapters.entries()) {
    if (entry.audioHref === audioHref && entry.chapter.start <= seconds) current = index;
  }
  if (current < 0) return null;
  if (direction > 0) return chapters[current + 1] ?? null;
  if (seconds - chapters[current]!.chapter.start > CHAPTER_RESTART_SEC) return chapters[current]!;
  return chapters[current - 1] ?? null;
};

export const findPairedAudiobookSection = (
  book: BookDoc,
  association: PairedAudiobook,
  from: number,
  direction: 1 | -1,
): number => {
  const narrated = new Set(
    pairedChapterEntries(book, association).map((entry) => entry.sectionIndex),
  );
  for (let index = from; index >= 0 && index < book.sections.length; index += direction) {
    if (narrated.has(index)) return index;
  }
  return -1;
};

export const loadPairedAudiobookSection = (
  book: BookDoc,
  association: PairedAudiobook,
  sectionIndex: number,
  doc: Document,
  lang: string,
): MediaOverlaySection | null => {
  const allToc = collectAudiobookTextChapters(book.toc ?? []);
  const tocInSection = allToc.filter(
    (chapter) => sectionIndexForHref(book, chapter.href) === sectionIndex,
  );
  const nextHref = new Map<string, string>();
  for (let index = 0; index < tocInSection.length - 1; index += 1) {
    nextHref.set(tocInSection[index]!.href, tocInSection[index + 1]!.href);
  }

  const pars: NarrationPar[] = [];
  for (const entry of pairedChapterEntries(book, association)) {
    if (entry.sectionIndex !== sectionIndex) continue;
    const firstTocItem = entry.tocItems[0]!;
    const lastTocItem = entry.tocItems.at(-1)!;
    const range = chapterRange(doc, firstTocItem.href, nextHref.get(lastTocItem.href));
    if (!range) continue;
    pars.push({
      markName: String(pars.length),
      blockIndex: pars.length,
      range,
      text: firstTocItem.label.trim() || entry.audioChapter.label,
      audioHref: entry.audioFile.path,
      clipBegin: entry.clipBegin,
      clipEnd: entry.clipEnd,
    });
  }

  return pars.length ? new MediaOverlaySection(pars, lang, 'approximate') : null;
};
