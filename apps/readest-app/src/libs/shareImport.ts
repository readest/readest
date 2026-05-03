import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getAPIBaseUrl } from '@/services/environment';
import { ShareApiError, getShare, type ImportShareResponse, type ShareMetadata } from './share';

interface EnsureSharedBookLocalArgs {
  token: string;
  importResult: ImportShareResponse;
  appService: AppService;
  /** Optional cached share metadata to avoid an extra GET on the new-import branch. */
  meta?: ShareMetadata;
  /** Progress callback for byte transfers (0-100). */
  onProgress?: (percent: number) => void;
}

/**
 * After `importShare(token)` succeeds (server-side R2 byte-copy done), make
 * sure the local library has BOTH the Book entry AND the bytes on local fs,
 * so opening the reader at the shared book works without a "Book not found"
 * error.
 *
 * Three branches:
 *  - Book is in library and bytes are present on fs → no-op, return book.
 *  - Book is in library but bytes are missing locally (e.g. previously deleted
 *    or imported from another device) → `appService.downloadBook` pulls from
 *    the recipient's R2 namespace, which the import endpoint just populated.
 *  - Book is NOT in the local library → fetch bytes via the public share
 *    download endpoint, then run `appService.importBook` so a proper local
 *    Book entry is created (metadata, cover extraction, dir layout). Mark
 *    `uploadedAt` + `coverDownloadedAt` so transferManager doesn't re-upload
 *    bytes the server already has, and so the cover-pull doesn't redo what
 *    `importBook` just extracted from the book file.
 */
export const ensureSharedBookLocal = async ({
  token,
  importResult,
  appService,
  meta,
  onProgress,
}: EnsureSharedBookLocalArgs): Promise<Book> => {
  const storeState = useLibraryStore.getState();
  const { setLibrary } = storeState;
  // When the share landing runs this helper, `libraryLoaded` is false because
  // /s/[token] doesn't mount useLibrary(). We load fresh from disk and only
  // push the result back into the store if the store had already been hydrated
  // by useLibrary somewhere else (e.g. /library, /reader, /opds). Otherwise we
  // *must not* set libraryLoaded ourselves: useLibrary's init block loads BOTH
  // the library AND `settings.globalReadSettings` in one go, and skips the
  // whole block when libraryLoaded is already true. Setting it prematurely
  // here leaves settings unloaded, and the Reader gate at Reader.tsx:167
  // (`libraryLoaded && settings.globalReadSettings`) renders the empty
  // fallback — exactly the blank-page symptom.
  const wasLibraryLoaded = storeState.libraryLoaded;
  const library = wasLibraryLoaded ? storeState.library : await appService.loadLibraryBooks();
  const findByHash = (hash: string): Book | undefined =>
    wasLibraryLoaded ? storeState.getBookByHash(hash) : library.find((b) => b.hash === hash);
  const existing = findByHash(importResult.bookHash);

  const persistLibrary = async () => {
    await appService.saveLibraryBooks(library);
    if (wasLibraryLoaded) setLibrary(library);
  };

  const reportProgress = onProgress
    ? (prog: { progress: number; total: number }) => {
        if (prog.total > 0) onProgress(Math.floor((prog.progress / prog.total) * 100));
      }
    : undefined;

  if (existing) {
    const bytesPresent = !!existing.downloadedAt && (await appService.isBookAvailable(existing));
    if (bytesPresent) return existing;

    // Pull from recipient's namespace — the import endpoint already byte-copied
    // both the book and the cover there. downloadBook handles missing-cover
    // gracefully (covers may not exist) and sets downloadedAt internally.
    await appService.downloadBook(existing, false, false, reportProgress);
    // cloudService.downloadBook is silent on failure: if the cloud path
    // mismatches the local Book's filename (e.g. share-import wrote bytes at
    // the sharer's title, recipient's local Book has a different title) the
    // function resolves without touching downloadedAt and the bytes are still
    // absent. Verify before claiming success — otherwise the recipient
    // navigates into the reader and hits "Book file not found".
    if (!(await appService.isBookAvailable(existing))) {
      throw new Error('Could not download shared book');
    }
    if (!existing.downloadedAt) existing.downloadedAt = Date.now();
    existing.updatedAt = Date.now();
    await persistLibrary();
    return existing;
  }

  // Book is not in the local library yet. Fetch the bytes via the public share
  // download endpoint (302 → presigned URL; fetch follows redirects), then
  // hand them to importBook which knows how to create the proper local Book.
  const shareMeta = meta ?? (await getShare(token));
  const downloadUrl = `${getAPIBaseUrl()}/share/${encodeURIComponent(token)}/download`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new ShareApiError(
      response.status,
      undefined,
      response.statusText || 'Could not download shared book',
    );
  }
  const blob = await response.blob();
  const filename = `${shareMeta.title}.${shareMeta.format.toLowerCase()}`;
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });

  const imported = await appService.importBook(file, library);
  if (!imported) {
    throw new Error('Could not import shared book');
  }

  // The server already holds the book + cover bytes (R2 byte-copy in the
  // import endpoint), so we tag uploadedAt/coverDownloadedAt to skip work
  // transferManager and the cloud cover-pull would otherwise repeat.
  const now = Date.now();
  imported.uploadedAt = now;
  if (!imported.downloadedAt) imported.downloadedAt = now;
  imported.coverDownloadedAt = now;

  await persistLibrary();
  return imported;
};
