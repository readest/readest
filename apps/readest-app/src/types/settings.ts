import { CustomTheme } from '@/styles/themes';
import { CustomFont } from '@/styles/fonts';
import { CustomTexture } from '@/styles/textures';
import { HighlightColor, HighlightStyle, UserHighlightColor, ViewSettings } from './book';
import { OPDSCatalog } from './opds';
import type { AISettings } from '@/services/ai/types';
import type { NotebookTab } from '@/store/notebookStore';
import type { DictionarySettings, ImportedDictionary } from '@/services/dictionaries/types';

export type ThemeType = 'light' | 'dark' | 'auto';
export type LibraryViewModeType = 'grid' | 'list';
export const LibrarySortByType = {
  Title: 'title',
  Author: 'author',
  Updated: 'updated',
  Created: 'created',
  Series: 'series',
  Size: 'size',
  Format: 'format',
  Published: 'published',
} as const;

export type LibrarySortByType = (typeof LibrarySortByType)[keyof typeof LibrarySortByType];

export type LibraryCoverFitType = 'crop' | 'fit';

export const LibraryGroupByType = {
  None: 'none',
  Group: 'group',
  Series: 'series',
  Author: 'author',
} as const;

export type LibraryGroupByType = (typeof LibraryGroupByType)[keyof typeof LibraryGroupByType];

export type KOSyncChecksumMethod = 'binary' | 'filename';
export type KOSyncStrategy = 'prompt' | 'silent' | 'send' | 'receive';

export interface ReadSettings {
  sideBarWidth: string;
  isSideBarPinned: boolean;
  notebookWidth: string;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  autohideCursor: boolean;
  translationProvider: string;
  translateTargetLang: string;
  highlightStyle: HighlightStyle;
  highlightStyles: Record<HighlightStyle, HighlightColor>;

  customHighlightColors: Record<HighlightColor, string>;
  userHighlightColors: UserHighlightColor[];
  defaultHighlightLabels: Partial<Record<HighlightColor, string>>;
  customTtsHighlightColors: string[];
  customThemes: CustomTheme[];
}

export interface KOSyncSettings {
  enabled: boolean;
  serverUrl: string;
  username: string;
  userkey: string;
  password?: string;
  deviceId: string;
  deviceName: string;
  checksumMethod: KOSyncChecksumMethod;
  strategy: KOSyncStrategy;
}

export interface ReadwiseSettings {
  enabled: boolean;
  accessToken: string;
  lastSyncedAt: number;
  /**
   * Advanced: override the Readwise API base URL (e.g. for a self-hosted,
   * Readwise-compatible receiver). When unset or blank, the official
   * `READWISE_API_BASE_URL` is used.
   */
  baseUrl?: string;
}

export interface HardcoverSettings {
  enabled: boolean;
  accessToken: string;
  lastSyncedAt: number;
}

export interface WebDAVSettings {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
  // Sync sub-toggles. WebDAV sync runs as a parallel channel alongside the
  // native cloud sync, KOSync, Readwise, and Hardcover; each sub-toggle
  // gates a category independently so a user can e.g. mirror progress to
  // their own server without uploading book binaries.
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  // Conflict policy — same vocabulary as KOSync so users only learn one.
  strategy?: KOSyncStrategy;
  // Stable per-device id (uuidv4); written into library.json so we can tell
  // which device last touched a given book.
  deviceId?: string;
  // Wall-clock millisecond timestamp of the last successful end-to-end
  // sync, surfaced in the WebDAV settings sub-page.
  lastSyncedAt?: number;
  // Diagnostic ring buffer: most recent ten "Sync now" runs, oldest first
  // dropped when full. Persisted alongside the rest of settings so users
  // can screenshot a failure breakdown when reporting issues. We keep the
  // cap small both for storage hygiene and because debugging beyond ten
  // back is rarely useful — by then the live state has long moved on.
  syncLog?: WebDAVSyncLogEntry[];
}

/**
 * Outcome category for one entry in {@link WebDAVSettings.syncLog}. We
 * keep this coarse on purpose — it drives the colour of the status pill
 * in the history panel and nothing else. Per-step counters travel in the
 * same entry for users who want detail.
 *
 * - `success`: ran to completion with `failures === 0` and at least one
 *   meaningful action (download/upload). "Up to date" runs (no work) also
 *   land here.
 * - `partial`: ran to completion but `failures > 0`. At least one book
 *   may need a re-sync to fully converge.
 * - `failure`: did not finish. Either a top-level error (auth failed,
 *   network down before any work) or every book failed.
 */
export type WebDAVSyncLogStatus = 'success' | 'partial' | 'failure';

export interface WebDAVSyncLogFailure {
  /** Stable identifier for the book — used as React key, never displayed. */
  hash: string;
  /** Human-readable book title at the time of the failed attempt. */
  title: string;
  /**
   * Short, single-line failure description. We deliberately strip stacks
   * and long server XML; users want "auth failed" / "404", not a wall of
   * text. Truncate to ~200 chars at write time so the persisted log
   * doesn't bloat settings.json.
   */
  reason: string;
}

export interface WebDAVSyncLogEntry {
  /** UUIDv4. Used as React list key and for "expand details" toggling. */
  id: string;
  /** Wall-clock ms when handleSyncNow began. */
  startedAt: number;
  /** Wall-clock ms when the run finished or aborted. */
  finishedAt: number;
  status: WebDAVSyncLogStatus;
  /**
   * What kind of run this entry records. Defaults to 'sync' when
   * absent so log entries persisted before this field was introduced
   * keep rendering the same way they always did. 'cleanup' is set
   * for entries written by the WebDAV browser's batch
   * Delete-from-server action; renderers use this to swap the badge
   * label and pick a cleanup-specific summary line.
   */
  kind?: 'sync' | 'cleanup';
  /**
   * What kicked off this run. v1 only writes 'manual' (the Sync now
   * button is the only entry point). The reader-hook auto-pushes are
   * intentionally NOT logged: they fire once per page-turn and would
   * drown out the manual-run signal users care about.
   */
  trigger: 'manual' | 'auto';
  /** Counters mirroring `SyncLibraryResult` — directly screenshot-friendly. */
  totalBooks: number;
  booksDownloaded: number;
  filesUploaded: number;
  filesAlreadyInSync: number;
  configsUploaded: number;
  configsDownloaded: number;
  coversUploaded: number;
  /**
   * Number of per-hash directories successfully removed from the
   * server in a cleanup run. Only meaningful when `kind === 'cleanup'`;
   * sync entries leave this undefined / zero. Kept optional to avoid
   * a migration step on existing settings.json files.
   */
  booksDeleted?: number;
  failures: number;
  /** The same one-liner shown in the toast. Kept for at-a-glance reading. */
  summary: string;
  /**
   * Top-level error message when the run aborted before processing
   * books (auth, root not reachable, connectivity). Mutually exclusive
   * with `failedBooks` in practice — a top-level abort means we never
   * iterated, so per-book failures don't apply.
   */
  errorMessage?: string;
  /** Per-book failure breakdown when `failures > 0`. */
  failedBooks?: WebDAVSyncLogFailure[];
}

/** Maximum entries retained in {@link WebDAVSettings.syncLog}. */
export const WEBDAV_SYNC_LOG_LIMIT = 10;

/**
 * User-facing sync categories. 'progress' gates the existing book-config
 * (reading progress) sync, 'note' gates annotations, 'book' gates book
 * binaries + metadata, 'dictionary' gates the imported-dictionary replica
 * sync. 'credentials' is a meta-toggle that gates the encrypted-credential
 * fields (OPDS username/password, KOSync credentials, Readwise / Hardcover
 * tokens) across whichever replica kinds carry them. Adding a new replica
 * kind extends this union.
 */
export type SyncCategory =
  | 'book'
  | 'progress'
  | 'note'
  | 'dictionary'
  | 'font'
  | 'texture'
  | 'opds_catalog'
  | 'settings'
  | 'credentials';

export const SYNC_CATEGORIES: readonly SyncCategory[] = [
  'book',
  'progress',
  'note',
  'dictionary',
  'font',
  'texture',
  'opds_catalog',
  'settings',
  'credentials',
] as const;

export interface KeyBinding {
  /** `native` = media keys forwarded by the OS bridge; `dom` = keyboard/D-pad keys. */
  source: 'native' | 'dom';
  /** Native key name (e.g. `MediaNext`) or DOM `event.code` (e.g. `ArrowLeft`). */
  id: string;
  /** Human-readable label shown in settings. */
  label: string;
}

export interface HardwarePageTurnerSettings {
  enabled: boolean;
  bindings: {
    pagePrev: KeyBinding | null;
    pageNext: KeyBinding | null;
    sectionPrev: KeyBinding | null;
    sectionNext: KeyBinding | null;
  };
}

export interface SystemSettings {
  version: number;
  migrationVersion: number;
  localBooksDir: string;
  customRootDir?: string;

  keepLogin: boolean;
  autoUpload: boolean;
  alwaysOnTop: boolean;
  openBookInNewWindow: boolean;
  autoCheckUpdates: boolean;
  screenWakeLock: boolean;
  screenBrightness: number;
  autoScreenBrightness: boolean;
  hardwarePageTurner: HardwarePageTurnerSettings;
  alwaysShowStatusBar: boolean;
  alwaysInForeground: boolean;
  openLastBooks: boolean;
  lastOpenBooks: string[];
  autoImportBooksOnOpen: boolean;
  savedBookCoverForLockScreen: string;
  savedBookCoverForLockScreenPath: string;
  telemetryEnabled: boolean;
  discordRichPresenceEnabled: boolean;
  libraryViewMode: LibraryViewModeType;
  librarySortBy: LibrarySortByType;
  librarySortAscending: boolean;
  libraryGroupBy: LibraryGroupByType;
  libraryCoverFit: LibraryCoverFitType;
  libraryAutoColumns: boolean;
  libraryColumns: number;
  customFonts: CustomFont[];
  customTextures: CustomTexture[];
  customDictionaries: ImportedDictionary[];
  dictionarySettings: DictionarySettings;
  opdsCatalogs: OPDSCatalog[];
  metadataSeriesCollapsed: boolean;
  metadataOthersCollapsed: boolean;
  metadataDescriptionCollapsed: boolean;
  lastSyncedAtBooks: number;
  lastSyncedAtConfigs: number;
  lastSyncedAtNotes: number;

  /**
   * App-lock PIN. When `pinCodeEnabled` is true, the user must enter
   * a 4-digit PIN before the library/reader is rendered on app launch.
   * `pinCodeHash` is `bytesToHex(PBKDF2-SHA256(pin, hexToBytes(pinCodeSalt)))`,
   * never the plaintext PIN. Cleared together with `pinCodeEnabled = false`
   * when the user disables the lock.
   */
  pinCodeEnabled?: boolean;
  pinCodeHash?: string;
  pinCodeSalt?: string;

  kosync: KOSyncSettings;
  readwise: ReadwiseSettings;
  hardcover: HardcoverSettings;
  webdav: WebDAVSettings;

  aiSettings: AISettings;
  /**
   * Per-device id used as the deviceId portion of every HLC this device
   * mints. Lazy-generated on first sync init via uuidv4 (mirrors
   * kosync.deviceId). Independent from kosync — the two services have
   * distinct identifier semantics and rotation policies.
   */
  replicaDeviceId?: string;
  /**
   * Per-kind cursor for replica sync. Stores the HLC string of the last
   * pulled row per kind. Absent kinds pull from the beginning.
   */
  lastSyncedAtReplicas?: Record<string, string>;
  /**
   * Per-category sync toggles. Missing keys default to ON. The
   * 'progress' category gates the existing book-config (reading
   * progress) sync; 'note' gates annotation sync; 'book' gates book
   * binary + metadata sync; 'dictionary' gates the imported-dictionary
   * replica sync. Future replica kinds add new SyncCategory members.
   */
  syncCategories?: Partial<Record<SyncCategory, boolean>>;

  // Global read settings that apply to the reader page
  globalReadSettings: ReadSettings;
  // Global view settings that apply to all books, and can be overridden by book-specific view settings
  globalViewSettings: ViewSettings;
}
