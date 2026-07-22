import { AppService } from '@/types/system';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { LocalStore } from './localStore';

/**
 * The app-backed {@link LocalStore} used by every file-sync consumer (the
 * reader hook and the library "Sync now" form). Consolidating the buffered +
 * streaming book/cover loaders here is the whole reason the bridge exists:
 * the logic used to be copy-pasted across both consumers.
 *
 * In-place imports keep their bytes outside `Books/<hash>/`, so the book-file
 * helpers resolve to `(book.filePath, 'None')` when `filePath` is set and fall
 * through to the hash-copy `Books`-relative path otherwise — mirroring
 * `cloudService.uploadBook` so sync treats in-place books as first-class.
 */
export const createAppLocalStore = ({
  appService,
  settings,
  envConfig,
}: {
  appService: AppService;
  settings: SystemSettings;
  envConfig: EnvConfigType;
}): LocalStore => ({
  loadConfig: (book) => appService.loadBookConfig(book, settings),
  saveBookConfig: (book, config) => appService.saveBookConfig(book, config, settings),

  loadBookFile: async (book) => {
    const fp = book.filePath ?? getLocalBookFilename(book);
    const base = book.filePath ? 'None' : 'Books';
    if (!(await appService.exists(fp, base))) return null;
    const file = await appService.openFile(fp, base);
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  resolveLocalBookPath: async (book) => {
    const fp = book.filePath ?? getLocalBookFilename(book);
    const base = book.filePath ? 'None' : 'Books';
    if (!(await appService.exists(fp, base))) return null;
    const file = await appService.openFile(fp, base);
    const size = file.size;
    // Release the FD before streaming so the Tauri side can re-open the path
    // for the PUT without contending.
    const closable = file as { close?: () => Promise<void> };
    if (closable.close) await closable.close();
    const path = await appService.resolveFilePath(fp, base);
    return { path, size };
  },

  saveBookFile: async (book, bytes) => {
    await appService.writeFile(getLocalBookFilename(book), 'Books', bytes);
  },

  prepareLocalBookPath: async (book) => {
    // The Rust downloader writes the file verbatim and does NOT create parent
    // dirs — make sure the per-hash folder under Books exists first.
    try {
      if (!(await appService.exists(book.hash, 'Books'))) {
        await appService.createDir(book.hash, 'Books', true);
      }
    } catch (e) {
      console.warn('createAppLocalStore: mkdir failed', book.hash, e);
    }
    return appService.resolveFilePath(getLocalBookFilename(book), 'Books');
  },

  loadBookCover: async (book) => {
    const fp = getCoverFilename(book);
    if (!(await appService.exists(fp, 'Books'))) return null;
    const file = await appService.openFile(fp, 'Books');
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  saveBookCover: async (book, bytes) => {
    await appService.writeFile(getCoverFilename(book), 'Books', bytes);
  },

  addBookToLibrary: async (book) => {
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      // Missing/broken cover shouldn't block adding the book — the bookshelf
      // renders a placeholder when coverImageUrl is empty.
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
      book.coverImageUrl = null;
    }
    book.syncedAt = Date.now();
    book.downloadedAt = Date.now();
    if (!book.metaHash) book.metaHash = book.hash;
    // Hydrate from disk if the store hasn't loaded yet. Merging against an
    // empty in-memory array would persist this book as the *entire* library
    // and clobber whatever is on disk. Mirrors useLibraryStore.updateBooks'
    // hardening; the Sync-now caller also hydrates up front, so this is
    // belt-and-suspenders for a data-loss path.
    let library = useLibraryStore.getState().library;
    if (!useLibraryStore.getState().libraryLoaded) {
      library = await appService.loadLibraryBooks();
      useLibraryStore.getState().setLibrary(library);
    }
    // Avoid duplicates if the user runs Sync now twice quickly.
    if (library.find((b) => b.hash === book.hash)) return;
    const newLibrary = [...library, book];
    await appService.saveLibraryBooks(newLibrary);
    // Update the store last so subscribers re-render against a library that's
    // already persisted on disk.
    useLibraryStore.getState().setLibrary(newLibrary);
  },

  updateBookMetadata: async (book) => {
    // The cover bytes were just refreshed via saveBookCover, so regenerate the
    // device-local blob URL the bookshelf renders.
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
    }
    book.syncedAt = Date.now();
    // Hydrate before updating: updateBook merges against the in-memory library,
    // so an unloaded store would persist an empty (or single-book) library and
    // clobber the disk. See the same guard in addBookToLibrary.
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks());
    }
    // updateBook persists via saveLibraryBooks and refreshes the store, so the
    // new title / author / cover show up without a reload.
    await useLibraryStore.getState().updateBook(envConfig, book);
  },

  markBooksUploaded: async (hashes, uploadedAt) => {
    if (!hashes.length) return;
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks());
    }
    // Stamp the LIVE rows (see the LocalStore contract): a book the user read
    // while the sync was running must keep the progress it saved meanwhile.
    const wanted = new Set(hashes);
    const rows = useLibraryStore
      .getState()
      .library.filter((book) => wanted.has(book.hash) && !book.uploadedAt && !book.deletedAt)
      .map((book) => ({ ...book, uploadedAt }));
    if (!rows.length) return;
    await useLibraryStore.getState().updateBooks(envConfig, rows);
  },

  deleteBookLocally: async (book) => {
    // Remove this device's managed copy of the book file (cloudService.deleteBook
    // with 'local' only ever touches app-managed Books/<hash>/ sources; an
    // in-place / external original is left untouched). The tombstone itself is
    // set by the engine before this call — we just persist it.
    try {
      await appService.deleteBook(book, 'local');
    } catch (e) {
      console.warn('createAppLocalStore: local book delete failed', book.hash, e);
    }
    book.coverImageUrl = null;
    book.syncedAt = Date.now();
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks());
    }
    await useLibraryStore.getState().updateBook(envConfig, book);
  },
});
