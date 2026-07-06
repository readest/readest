import type { Book, BookLookupIndex } from '@/types/book';
import type { AppService, OsPlatform } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { transferManager } from '@/services/transferManager';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { normalizeFilePathForIndex } from '@/services/bookService';
import { isContentURI, isValidURL } from '@/utils/misc';
import { isPseStreamFileName } from '@/services/opds/pseStream';

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
  //
  // Defer the actual canonicalization to `normalizeFilePathForIndex` so the
  // path index (`BookLookupIndex.byFilePath`) and this in-place decision
  // agree on what counts as the same path — otherwise a re-import could
  // hit the in-place branch here but miss the fast-path dedup in
  // importBook (or vice versa).
  const norm = (p: string) => normalizeFilePathForIndex(p, osPlatform);
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

  // In-place re-import fast path. When the source file lives under one of
  // the user's registered external library folders and the byFilePath index
  // already knows about it, skip importBook entirely and return the existing
  // library entry verbatim. No fs.openFile, no native parser, no partialMD5,
  // no timestamp / cover / config writes — and crucially no downstream group
  // / tag / upload logic, so a re-scan can't silently rewrite library sort
  // order or clobber a manual GroupingModal assignment via a path-derived
  // group string.
  //
  // This is intentionally separate from importBook's byHash / byMetaKey
  // dedup: a byHash hit means a *different* source path resolves to a known
  // book (drop a copy from elsewhere, or revive a soft-deleted entry), which
  // correctly clears `deletedAt` and refreshes timestamps. A byFilePath hit
  // is the same on-disk file at the same path — there is nothing to refresh,
  // and refreshing would silently rewrite library sort order on every
  // re-scan. Soft-deleted books are excluded from `byFilePath` at index
  // build time so they fall through to byHash and get resurrected.
  //
  // Reject URLs, content URIs and PSE streams defensively. The byFilePath
  // index only carries real on-disk paths, but `inPlace` could in principle
  // be set on a non-path source by a buggy caller.
  if (
    inPlace &&
    !opts.transient &&
    opts.lookupIndex &&
    typeof opts.file === 'string' &&
    !isPseStreamFileName(opts.file) &&
    !isValidURL(opts.file) &&
    !isContentURI(opts.file)
  ) {
    const key = normalizeFilePathForIndex(opts.file, appService.osPlatform);
    const existing = key ? opts.lookupIndex.byFilePath.get(key) : undefined;
    if (existing) {
      return existing;
    }
  }

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
  // When a third-party provider (WebDAV/Drive) is the selected cloud sync
  // backend, Readest Cloud storage is not written to at all — the file-sync
  // engine mirrors the import instead (including Sent books, which then reach
  // other devices via that provider when its syncBooks toggle is on).
  if (
    !opts.transient &&
    isLoggedIn &&
    !book.uploadedAt &&
    (opts.forceUpload || settings.autoUpload) &&
    isReadestCloudStorageActive(settings)
  ) {
    transferManager.queueUpload(book);
  }

  return book;
}
