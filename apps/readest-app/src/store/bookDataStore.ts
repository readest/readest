import { create } from 'zustand';
import { SystemSettings } from '@/types/settings';
import { Book, BookConfig, BookNote } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { BookDoc } from '@/libs/document';
import { useLibraryStore } from './libraryStore';

// Throttle library.json writes triggered by per-book saveConfig.
//
// Why: `saveConfig` ran two large fs.writeFile IPC calls *every* invocation —
// one for the per-book config.json and one for the WHOLE library.json (because
// saveLibraryBooks writes a backup + the file itself). For a user with N
// books in their shelf, that's `2 * JSON.stringify(N entries)` of work + 2
// Tauri IPC round-trips per save. With auto-save firing once per second of
// reading (useProgressAutoSave), Chrome DevTools' Bottom-Up profile shows
// `processIpcMessage` chewing ~25% of main-thread time during a reading
// session — directly responsible for the swipe jank the user is reporting
// (touchmove gets queued behind IPC processing).
//
// The library array itself is updated immutably via setLibrary on every save
// (see `setLibrary(newLibrary)` below) so in-memory state and zustand
// subscribers see the change immediately. Disk persistence can be deferred:
// progress is also stored in each book's own config.json (which we still
// write every time), so even if the app dies between throttle ticks the
// shelf will reconstruct correct progress from those per-book files on
// next launch.
//
// LIBRARY_SAVE_THROTTLE_MS=30s: long enough to collapse a swipe burst into a
// single IPC, short enough that a user who closes the book within half a
// minute still sees the shelf update without a follow-up flush. Force-flush
// happens via flushPendingLibrarySave() on hook unmount + window blur.
const LIBRARY_SAVE_THROTTLE_MS = 30_000;
let librarySaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
let librarySaveAppService: { saveLibraryBooks: (books: Book[]) => Promise<void> } | null = null;
const scheduleLibrarySave = (appService: {
  saveLibraryBooks: (books: Book[]) => Promise<void>;
}) => {
  librarySaveAppService = appService;
  if (librarySaveTimeoutId != null) return;
  librarySaveTimeoutId = setTimeout(() => {
    librarySaveTimeoutId = null;
    const svc = librarySaveAppService;
    if (!svc) return;
    const { library } = useLibraryStore.getState();
    svc.saveLibraryBooks(library).catch((err) => {
      console.warn('Throttled library save failed:', err);
    });
  }, LIBRARY_SAVE_THROTTLE_MS);
};
export const flushPendingLibrarySave = async () => {
  if (librarySaveTimeoutId == null || !librarySaveAppService) return;
  clearTimeout(librarySaveTimeoutId);
  librarySaveTimeoutId = null;
  const { library } = useLibraryStore.getState();
  await librarySaveAppService.saveLibraryBooks(library);
};

export interface BookData {
  /* Persistent data shared with different views of the same book */
  id: string;
  book: Book | null;
  file: File | null;
  config: BookConfig | null;
  bookDoc: BookDoc | null;
  isFixedLayout: boolean;
}

interface BookDataState {
  booksData: { [id: string]: BookData };
  getConfig: (key: string | null) => BookConfig | null;
  setConfig: (key: string, partialConfig: Partial<BookConfig>) => void;
  saveConfig: (
    envConfig: EnvConfigType,
    bookKey: string,
    config: BookConfig,
    settings: SystemSettings,
  ) => Promise<void>;
  updateBooknotes: (key: string, booknotes: BookNote[]) => BookConfig | undefined;
  getBookData: (keyOrId: string) => BookData | null;
  clearBookData: (keyOrId: string) => void;
}

export const useBookDataStore = create<BookDataState>((set, get) => ({
  booksData: {},
  getBookData: (keyOrId: string) => {
    const id = keyOrId.split('-')[0]!;
    return get().booksData[id] || null;
  },
  clearBookData: (keyOrId: string) => {
    const id = keyOrId.split('-')[0]!;
    set((state) => {
      const newBooksData = { ...state.booksData };
      delete newBooksData[id];
      return {
        booksData: newBooksData,
      };
    });
  },
  getConfig: (key: string | null) => {
    if (!key) return null;
    const id = key.split('-')[0]!;
    return get().booksData[id]?.config || null;
  },
  setConfig: (key: string, partialConfig: Partial<BookConfig>) => {
    set((state: BookDataState) => {
      const id = key.split('-')[0]!;
      const config = state.booksData[id]?.config;
      if (!config) {
        console.warn('No config found for book', id);
        return state;
      }
      return {
        booksData: {
          ...state.booksData,
          [id]: {
            ...state.booksData[id]!,
            config: { ...config, ...partialConfig },
          },
        },
      };
    });
  },
  saveConfig: async (
    envConfig: EnvConfigType,
    bookKey: string,
    config: BookConfig,
    settings: SystemSettings,
  ) => {
    const appService = await envConfig.getAppService();
    const { library, hashIndex, setLibrary } = useLibraryStore.getState();
    const hash = bookKey.split('-')[0]!;
    const idx = hashIndex.get(hash);
    if (idx === undefined) return;

    // Immutably move the book to the front of the library with updated
    // progress and timestamps. We do NOT mutate the existing book object or
    // the existing library array — Zustand subscribers see fresh references
    // and the visibleLibrary cache stays in sync via setLibrary's full update.
    const now = Date.now();
    const original = library[idx]!;
    const updatedBook: Book = {
      ...original,
      progress: config.progress,
      timeRemainingMinutes: config.timeRemainingMinutes,
      updatedAt: now,
      downloadedAt: original.downloadedAt || now,
    };
    const newLibrary = [updatedBook, ...library.slice(0, idx), ...library.slice(idx + 1)];
    setLibrary(newLibrary);

    // Refresh updatedAt immutably via the store rather than mutating the
    // caller-provided object. This notifies Zustand subscribers and works
    // regardless of whether the caller passed the shared store config.
    get().setConfig(bookKey, { updatedAt: now });
    const configToSave = { ...config, updatedAt: now };
    // Per-book config: still write eagerly — it's small (one book's
    // settings + booknotes) and is the source of truth used by sync to
    // reconstruct the shelf if library.json is missing or stale.
    await appService.saveBookConfig(updatedBook, configToSave, settings);
    // Library JSON write: throttled (see scheduleLibrarySave docs) so a
    // burst of saveConfig calls during reading doesn't fire IPC on every
    // page turn.
    scheduleLibrarySave(appService);
  },
  updateBooknotes: (key: string, booknotes: BookNote[]) => {
    let updatedConfig: BookConfig | undefined;
    set((state) => {
      const id = key.split('-')[0]!;
      const book = state.booksData[id];
      if (!book) return state;
      const dedupedBooknotes = Array.from(
        new Map(booknotes.map((item) => [`${item.id}-${item.type}-${item.cfi}`, item])).values(),
      );
      updatedConfig = {
        ...book.config,
        updatedAt: Date.now(),
        booknotes: dedupedBooknotes,
      };
      return {
        booksData: {
          ...state.booksData,
          [id]: {
            ...book,
            config: {
              ...book.config,
              updatedAt: Date.now(),
              booknotes: dedupedBooknotes,
            },
          },
        },
      };
    });
    return updatedConfig;
  },
}));
