import type { Book, BookLookupIndex } from '@/types/book';
import type { AppService, OsPlatform } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { transferManager } from '@/services/transferManager';

export interface IngestFileDeps {
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
  /**
   * Pre-resolved absolute path to Readest's own `Books/` directory. When
   * provided, any source file already living under this prefix is excluded
   * from in-place import (it is, by definition, a hash copy we wrote). The
   * caller is expected to resolve it once per batch via
   * `appService.fs.getPrefix('Books')` instead of paying the async cost
   * per ingested file. Omit (or pass null) on contexts where the lookup is
   * unavailable — in-place decisions will then proceed without this guard.
   */
  appBooksPrefix?: string | null;
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
  /**
   * Opt out of automatic in-place import even when the source file lives under
   * the user's custom root directory. Forces the legacy behavior of copying
   * the file into Books/<hash>/. Defaults to false.
   */
  forceCopy?: boolean;
}

/**
 * Decide whether `file` should be imported in-place (read directly from its
 * source location) instead of copied into Books/<hash>/.
 *
 * Conditions (all must hold):
 *   - `file` is an absolute path string (not a File / blob / URL / content URI).
 *   - The path lives under one of the user's registered in-place roots
 *     (`settings.externalLibraryFolders`) — directories the user has
 *     explicitly told Readest to read in place. The Readest data location
 *     (`customRootDir`) is intentionally NOT an in-place trigger; that
 *     directory is Readest's own home and may freely contain hash copies.
 *   - The path is NOT inside Readest's own managed books directory
 *     (`appBooksPrefix`, e.g. `<AppData>/Books/`). Anything in that subtree
 *     is a hash copy under Readest's control, no point marking it in-place.
 *     We compare against the actual app data path rather than rejecting any
 *     `<root>/Books/` segment — users routinely have unrelated folders named
 *     `Books` inside their library roots (Baidu Netdisk's default layout,
 *     Calibre exports, etc.) and those must still go in-place.
 *   - Caller did not request `transient` (transient already opts out of
 *     copying via its own filePath path) or `forceCopy`.
 *
 * Returns false in any other case, including web (File objects), URLs, and
 * relative paths.
 *
 * Known limitation: symlinks are not resolved. A registered root of
 * `/Users/me/Library` will NOT match a file accessed through a sibling
 * symlink like `/Users/me/LibrarySymlink/sample.epub` even when both point
 * at the same on-disk directory. Adding best-effort realpath resolution
 * requires async I/O and a cross-platform `realpath` capability on
 * `FileSystem`, which is out of scope for this change.
 */
function shouldImportInPlace(
  file: File | string,
  opts: Pick<IngestFileOptions, 'transient' | 'forceCopy'>,
  inPlaceRoots: string[],
  osPlatform: OsPlatform,
  appBooksPrefix: string | null,
): boolean {
  if (opts.transient || opts.forceCopy) return false;
  if (typeof file !== 'string') return false;
  if (inPlaceRoots.length === 0) return false;

  // Absolute path check that works for POSIX and Windows without pulling in
  // node:path (this code also runs in the renderer on web/mobile builds).
  const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(file);
  const isAbs = file.startsWith('/') || isWindowsDrive || file.startsWith('\\\\');
  if (!isAbs) return false;

  // Reject anything that smells like a URL or content URI. Windows drive
  // letters (`C:\…`) match a "scheme:rest" shape too, so exclude them
  // explicitly — `isWindowsDrive` already vouched for those.
  if (!isWindowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(file)) return false;

  // macOS (APFS/HFS+ default), iOS, and Windows ship case-insensitive
  // filesystems out of the box, so `/Users/me/Library` and
  // `/users/me/library` must compare equal there. Linux and Android are
  // case-sensitive and stay strict. We do not attempt unicode normalization
  // (NFC/NFD) — APFS handles that at the FS layer and `toLocaleLowerCase`
  // with the wrong locale would introduce its own bugs (e.g. Turkish `İ`).
  const caseInsensitive =
    osPlatform === 'macos' || osPlatform === 'ios' || osPlatform === 'windows';
  const norm = (p: string) => {
    const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return caseInsensitive ? n.toLowerCase() : n;
  };
  const target = norm(file);

  // If the file already lives inside Readest's own managed books directory
  // we never want to "in-place" it: it is, by definition, a hash copy we
  // produced ourselves. Compare against the actual resolved app prefix so
  // unrelated user-owned folders that happen to be named `Books` (very
  // common in cloud-drive layouts like Baidu Netdisk's `Books/` root) are
  // left untouched and imported in-place when they fall under a registered
  // external root.
  if (appBooksPrefix) {
    const appBooks = norm(appBooksPrefix);
    if (appBooks && (target === appBooks || target.startsWith(appBooks + '/'))) {
      return false;
    }
  }

  for (const raw of inPlaceRoots) {
    if (!raw) continue;
    const root = norm(raw);
    if (!root) continue;
    // Guard against root-as-prefix-of-different-dir (`/foo` vs `/foobar`).
    if (target !== root && !target.startsWith(root + '/')) continue;
    return true;
  }
  return false;
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
  const { appService, settings, isLoggedIn, appBooksPrefix } = deps;

  const inPlaceRoots = settings.externalLibraryFolders ?? [];
  const inPlace = shouldImportInPlace(
    opts.file,
    opts,
    inPlaceRoots,
    appService.osPlatform,
    appBooksPrefix ?? null,
  );

  const book = await appService.importBook(opts.file, opts.books, {
    lookupIndex: opts.lookupIndex,
    transient: opts.transient,
    inPlace,
  });
  if (!book) return null;

  // Tri-state: undefined leaves whatever group the existing
  // (deduped) book already had untouched; an explicit string —
  // including the empty string — replaces it. The empty-string case
  // is what library imports use to "demote" a book back to the root
  // when the user picks Import-from-Folder → flatten on a previously
  // grouped book.
  if (opts.groupId !== undefined) {
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
  // Transient imports are never uploaded — they're short-lived previews
  // (e.g. /send view) and shouldn't pollute the user's cloud library.
  // In-place imports (book.filePath set, content under one of the user's
  // external library folders) DO get uploaded: from a backup/sync standpoint
  // they are equivalent to a hash-copy book — only the local storage
  // location differs. uploadBook reads straight from book.filePath in that
  // case; downloads on other devices land in Books/<hash>/ as a normal copy.
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
