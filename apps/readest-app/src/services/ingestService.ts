import type { Book, BookLookupIndex } from '@/types/book';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { transferManager } from '@/services/transferManager';

export interface IngestFileDeps {
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
}

export interface IngestFileOptions {
  /** A file path (desktop/mobile) or a File object (web). */
  file: File | string;
  /** Current library, used by importBook for dedup. */
  books: Book[];
  /** Pre-built lookup index for O(1) dedup during batch imports. */
  lookupIndex?: BookLookupIndex;
  /** Collection to place the book in. */
  groupId?: string;
  groupName?: string;
  /** Tag parsed from a Send-to-Readest email subject (`#scifi`). */
  subjectTag?: string;
  /** Upload to the cloud even when the user has disabled autoUpload. */
  forceUpload?: boolean;
  /** Transient import (not stored long-term) — never uploaded. */
  transient?: boolean;
}

/**
 * Channel-agnostic single-file ingestion. Every capture channel — local library
 * import, the /send page, the inbox drainer — calls this so a sent book behaves
 * exactly like a locally-imported one.
 *
 * Persistence (`updateBooks` / `saveLibraryBooks`) and the sync push stay with
 * the caller on purpose: batch importers save once per batch, single-item
 * callers save per item. The shared logic that must NOT diverge — importing,
 * group/tag metadata, the upload decision — lives here.
 */
export async function ingestFile(
  opts: IngestFileOptions,
  deps: IngestFileDeps,
): Promise<Book | null> {
  const { appService, settings, isLoggedIn } = deps;

  const book = await appService.importBook(opts.file, opts.books, {
    lookupIndex: opts.lookupIndex,
    transient: opts.transient,
  });
  if (!book) return null;

  if (opts.groupId) {
    book.groupId = opts.groupId;
    book.groupName = opts.groupName;
  }

  const tag = opts.subjectTag?.trim();
  if (tag) {
    const tags = book.tags ?? [];
    if (!tags.includes(tag)) {
      book.tags = [...tags, tag];
      book.updatedAt = Date.now();
    }
  }

  // Sent books force the upload so they reach the user's other devices even
  // when autoUpload is off; normal library imports honor the setting.
  // Transient imports are never uploaded.
  if (
    !opts.transient &&
    isLoggedIn &&
    !book.uploadedAt &&
    (opts.forceUpload || settings.autoUpload)
  ) {
    transferManager.queueUpload(book);
  }

  return book;
}
