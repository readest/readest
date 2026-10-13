// Pairing a BookOrbit ebook with its audiobook at import time, without a wizard.
//
// The wizard exists because an Audiobookshelf ebook and audiobook are separate
// items a person has to match up. A BookOrbit entry is one book that happens to
// offer both -- its OPDS entry shows "Download EPUB" beside "Play" -- so there
// is no choice to present. Importing the ebook is enough to know what the
// narration is.
//
// Everything here is best effort: the import that triggered it must succeed
// whether or not the pairing does.
import type { BookOrbitManifest } from './manifest';
import { buildBookOrbitPairing } from './pairing';
import type { Book, BookConfig } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

export interface AutoPairDeps {
  book: Book;
  /** BookOrbit book id, taken from the acquisition href of the same entry. */
  bookId: number;
  loadManifest: (bookId: number) => Promise<BookOrbitManifest>;
  /** Ebook chapter ids in reading order, from the imported file's TOC. */
  loadTocChapterIds: (book: Book) => Promise<string[]>;
  appService: {
    loadBookConfig: (book: Book, settings: SystemSettings) => Promise<BookConfig>;
    saveBookConfig: (book: Book, config: BookConfig, settings?: SystemSettings) => Promise<void>;
  };
  settings: SystemSettings;
}

/** True when a pairing was written, false when it was skipped for any reason. */
export const autoPairBookOrbitAudiobook = async (deps: AutoPairDeps): Promise<boolean> => {
  const { book, bookId, loadManifest, loadTocChapterIds, appService, settings } = deps;
  try {
    const config = await appService.loadBookConfig(book, settings);
    // Never overwrite a pairing already there: the user may have adjusted the
    // mappings by hand, and a re-import must not throw that away.
    if (config.audiobook) return false;

    const ebookChapterIds = await loadTocChapterIds(book);
    // With no TOC there is nothing to map the narration against; pairing the
    // audio to an empty list would produce an association that cannot narrate.
    if (ebookChapterIds.length === 0) return false;

    const manifest = await loadManifest(bookId);
    const audiobook = buildBookOrbitPairing(manifest, ebookChapterIds);
    if (audiobook.chapters.length === 0) return false;

    await appService.saveBookConfig(
      book,
      {
        ...config,
        audiobook,
        viewSettings: { ...config.viewSettings, ttsUseNarration: true },
        updatedAt: Date.now(),
      } as BookConfig,
      settings,
    );
    return true;
  } catch (error) {
    console.warn('[BookOrbit] auto-pairing the audiobook failed:', error);
    return false;
  }
};

/**
 * Ebook chapter ids, in reading order, for a book already imported to disk.
 *
 * The TOC lives on the parsed document, which the import does not hand back,
 * so the file is opened once here -- the same thing the library search index
 * does to read a book outside the reader. Sub-sections are left out: only a
 * top-level entry can correspond to an audio chapter.
 */
export const loadEbookChapterIds = async (
  appService: {
    loadBookContent: (book: Book) => Promise<{ file: File }>;
    resolveNativeBookFilePath: (book: Book) => Promise<string | null>;
  },
  book: Book,
): Promise<string[]> => {
  const [content, nativeFilePath] = await Promise.all([
    appService.loadBookContent(book),
    appService.resolveNativeBookFilePath(book),
  ]);
  const { DocumentLoader } = await import('@/libs/document');
  const { collectTopLevelChapterIds } = await import('./pairing');
  const bookDoc = (
    await new DocumentLoader(content.file, {
      nativeFilePath: nativeFilePath ?? undefined,
    }).open()
  ).book;
  // Top level only: the wizard's flattening pulls a story's sub-sections in as
  // chapters of their own, which never correspond to audio chapters.
  return collectTopLevelChapterIds(bookDoc.toc ?? []);
};
