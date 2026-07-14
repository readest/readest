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
  Progress: 'progress',
  TimeRemaining: 'timeRemaining',
} as const;

export type LibrarySortByType = (typeof LibrarySortByType)[keyof typeof LibrarySortByType];

/**
 * Secondary sort key. Same options as the primary sort key plus `'none'` which
 * disables the secondary sort. When set to `'none'` and a smart default applies
 * (e.g. groupBy=Author -> series), the resolver in `libraryUtils` substitutes
 * the implicit default at sort time without persisting it. See
 * `resolveEffectiveSecondarySort`.
 */
export type LibrarySecondarySortByType = LibrarySortByType | 'none';

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
  /**
   * Global Word Lens toggle: auto-download a gloss pack on demand when the
   * pair isn't cached locally. When off, the reader never fetches packs
   * silently; users download them explicitly from the Word Lens sub-page.
   */
  wordLensAutoDownload: boolean;
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
  // When true, progress + notes are pushed to Hardcover automatically as the
  // user reads (debounced) instead of only via the reader menu. Default OFF;
  // existing connected users (undefined) stay manual until they opt in.
  autoSync?: boolean;
}

/**
 * Sort field for the WebDAV browser listing. 'name' reproduces the
 * legacy directories-first/alphabetical default; the date fields drive
 * the "pull up recent books" use case ('created' relies on the server
 * reporting `<creationdate>`, which not all do). 'size' orders files.
 */
export type WebDAVBrowseSortByType = 'name' | 'modified' | 'created' | 'size';

export interface WebDAVSettings {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
  // Browser sort preference, persisted so a chosen "recent first" order
  // survives across sessions. Both optional: absent => name/ascending,
  // matching the pre-feature default (no migration needed).
  browseSortBy?: WebDAVBrowseSortByType;
  browseSortAscending?: boolean;
  // Sync sub-toggles. WebDAV sync runs as a parallel channel alongside the
  // native cloud sync, KOSync, Readwise, and Hardcover; each sub-toggle
  // gates a category independently so a user can e.g. mirror progress to
  // their own server without uploading book binaries.
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  // When true, "Sync now" re-checks every book instead of only those whose
  // local copy differs from the shared library.json index (the default
  // incremental walk). An escape hatch for drift or a first full sync.
  fullSync?: boolean;
  // Conflict policy — same vocabulary as KOSync so users only learn one.
  strategy?: KOSyncStrategy;
  // Stable per-device id (uuidv4); written into library.json so we can tell
  // which device last touched a given book.
  deviceId?: string;
  // Wall-clock millisecond timestamp of the last successful end-to-end
  // sync, surfaced in the WebDAV settings sub-page.
  lastSyncedAt?: number;
  // Device-local wall-clock millis of when this provider was made the
  // selected cloud sync backend on THIS device. Anchors the mixed-fleet
  // detection probe: any native /api/sync row newer than this means
  // another device is still writing the gated channels.
  providerSelectedAt?: number;
}

/**
 * Google Drive file-sync settings. A second file-sync backend alongside
 * {@link WebDAVSettings}, sharing the same engine, sub-toggles, and strategy
 * vocabulary. Drive has no URL / credentials / root path (it is OAuth + a
 * fixed `/Readest` namespace under the `drive.file` scope), and no BYO client.
 * The OAuth token is NOT stored here — it lives in the OS keychain. `deviceId`
 * and `lastSyncedAt` are device-local (excluded from cross-device restore).
 */
export interface GoogleDriveSettings {
  enabled: boolean;
  /** Connected account's email (or display name), shown in the settings UI. */
  accountLabel?: string;
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  fullSync?: boolean;
  strategy?: KOSyncStrategy;
  deviceId?: string;
  lastSyncedAt?: number;
  /** See {@link WebDAVSettings.providerSelectedAt}. */
  providerSelectedAt?: number;
}

/**
 * S3-compatible object-store file-sync settings — the third file-sync
 * backend alongside {@link WebDAVSettings} and {@link GoogleDriveSettings},
 * sharing the same engine, sub-toggles, and strategy vocabulary. Covers any
 * SigV4 endpoint: Cloudflare R2, AWS S3, MinIO, Backblaze B2. Addressing is
 * path-style (`<endpoint>/<bucket>/<key>`). Credentials live here like
 * WebDAV's (same encrypted cross-device credential-sync semantics).
 */
export interface S3Settings {
  enabled: boolean;
  /** Service endpoint origin, e.g. `https://<account-id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** SigV4 region; 'auto' works for R2/MinIO, AWS wants the bucket region. */
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  fullSync?: boolean;
  strategy?: KOSyncStrategy;
  deviceId?: string;
  lastSyncedAt?: number;
  /** See {@link WebDAVSettings.providerSelectedAt}. */
  providerSelectedAt?: number;
}

/**
 * Microsoft OneDrive file-sync settings. An OAuth-based file-sync backend
 * alongside {@link GoogleDriveSettings}, storing data in the Graph App Folder
 * (approot). No URL / credentials / root path and no BYO client; the OAuth
 * token lives in the OS keychain (native) or sessionStorage (web), never here.
 * `deviceId`/`lastSyncedAt`/`providerSelectedAt` are device-local.
 */
export interface OneDriveSettings {
  enabled: boolean;
  /** Connected account's userPrincipalName/email, shown in the settings UI. */
  accountLabel?: string;
  syncProgress?: boolean;
  syncNotes?: boolean;
  syncBooks?: boolean;
  fullSync?: boolean;
  strategy?: KOSyncStrategy;
  deviceId?: string;
  lastSyncedAt?: number;
  /** See {@link WebDAVSettings.providerSelectedAt}. */
  providerSelectedAt?: number;
}

/**
 * Readest Cloud's own library-sync switch. Readest Cloud used to be the
 * derived fallback — "on" whenever no third-party provider was enabled —
 * because exactly one provider could own the library channels. Providers are
 * now independently selectable (#5062), so Readest Cloud needs a flag of its
 * own.
 *
 * `enabled` is DELIBERATELY optional with no default (this slice must never
 * enter `DEFAULT_SYSTEM_SETTINGS`): an absent value falls back to the old
 * derivation, so upgrading users keep exactly the behaviour they had and no
 * migration has to rewrite anyone's settings. It is written only once the user
 * touches a Cloud Sync checkbox.
 *
 * Device-local, like the other providers' `enabled` flags.
 */
export interface ReadestCloudSettings {
  enabled?: boolean;
  /**
   * Device-local wall-clock millis of when this device turned Readest Cloud
   * off. Anchors the mixed-fleet probe: a native /api/sync row newer than this
   * means another device is still writing the channels this one stopped
   * writing. Excluded from cross-device restore.
   */
  disabledAt?: number;
}

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
  | 'credentials'
  | 'stats';

export const SYNC_CATEGORIES: readonly SyncCategory[] = [
  'book',
  'progress',
  'note',
  'dictionary',
  'font',
  'texture',
  'opds_catalog',
  'settings',
  'stats',
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
    /** E-ink full screen refresh (clears ghosting). Optional: absent on settings persisted before the feature existed. */
    refresh?: KeyBinding | null;
  };
}

export interface SystemSettings {
  version: number;
  migrationVersion: number;
  localBooksDir: string;
  customRootDir?: string;
  /**
   * Absolute paths the user has registered as "external library folders" —
   * directories managed by the user (or another reader app, e.g. Duokan,
   * Calibre, Moon+ Reader) that Readest should read in place instead of
   * copying into Books/<hash>/. Each entry must be an absolute path; entries
   * are matched as path-prefix roots when ingesting a file. Device-local
   * (path is meaningful only on this filesystem) and excluded from cloud
   * settings backups via `BACKUP_SETTINGS_BLACKLIST`.
   */
  externalLibraryFolders?: string[];
  /**
   * Absolute paths of the external library folders the user has opted into
   * auto-import for. On library open and whenever the app regains focus,
   * Readest re-scans each of these and imports any newly-added book files.
   * A subset of {@link externalLibraryFolders} (auto-import requires the
   * folder to be read in place). Set per-folder from the Import-from-Folder
   * dialog. Desktop + Android only. Device-local (paths are meaningful only
   * on this filesystem) and excluded from cloud settings backups via
   * `BACKUP_SETTINGS_BLACKLIST`.
   */
  autoImportFolders?: string[];

  keepLogin: boolean;
  autoUpload: boolean;
  alwaysOnTop: boolean;
  openBookInNewWindow: boolean;
  autoCheckUpdates: boolean;
  updateChannel: 'stable' | 'nightly';
  screenWakeLock: boolean;
  screenBrightness: number;
  autoScreenBrightness: boolean;
  swipeBrightnessGesture: boolean;
  hardwarePageTurner: HardwarePageTurnerSettings;
  alwaysShowStatusBar: boolean;
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
  /**
   * Whether the primary sort uses a smart default derived from `libraryGroupBy`.
   * When `true` and grouping by Series, the effective primary sort becomes
   * Series at sort time (the stored `librarySortBy` is left unchanged so users
   * who later turn auto off keep their previous explicit pick). Flipped to
   * `false` the moment the user picks any primary sort in the menu.
   */
  librarySortByAuto: boolean;
  librarySortBy2: LibrarySecondarySortByType;
  libraryGroupBy: LibraryGroupByType;
  libraryCoverFit: LibraryCoverFitType;
  libraryAutoColumns: boolean;
  libraryColumns: number;
  /** Show the recently-read carousel at the top of the library (issue #3797). */
  libraryRecentShelfEnabled: boolean;
  /**
   * Library page background texture, configured independently from the reader
   * background (issue #4743). When any of these is undefined the library
   * inherits the corresponding `globalViewSettings.background*` value, so an
   * existing user's bookshelf looks unchanged until they pick a library
   * texture. Device-local (the texture *selection* never syncs, matching the
   * reader's `backgroundTextureId`); only the imported image binaries sync via
   * the `texture` replica kind. Resolved by `getLibraryViewSettings`.
   */
  libraryBackgroundTextureId?: string;
  libraryBackgroundOpacity?: number;
  libraryBackgroundSize?: string;
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
  /**
   * Mobile-only. When true AND a PIN lock is configured AND the device
   * has enrolled biometrics, the app-lock screen prompts for biometrics
   * (fingerprint / Face ID) first and falls back to the PIN. No effect on
   * desktop/web (no biometric plugin). `undefined` is treated as `false`
   * so existing PIN users are never silently switched to biometric.
   */
  biometricUnlockEnabled?: boolean;

  kosync: KOSyncSettings;
  readwise: ReadwiseSettings;
  hardcover: HardcoverSettings;
  /** Optional by design — see {@link ReadestCloudSettings}. Never defaulted. */
  readestCloud?: ReadestCloudSettings;
  webdav: WebDAVSettings;
  googleDrive: GoogleDriveSettings;
  s3: S3Settings;
  onedrive: OneDriveSettings;

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
