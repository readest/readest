import { invoke, Channel } from '@tauri-apps/api/core';
import { getOSPlatform } from '@/utils/misc';

export interface CopyURIRequest {
  uri: string;
  dst: string;
}

export interface CopyURIResponse {
  success: boolean;
  error?: string;
}

export interface SaveImageToGalleryRequest {
  srcPath: string;
  fileName: string;
  mimeType: string;
  albumName?: string;
}

export interface SaveImageToGalleryResponse {
  success: boolean;
  uri?: string;
  error?: string;
}

export interface UseBackgroundAudioRequest {
  enabled: boolean;
}

export interface SetSelectionSuppressedRequest {
  target: 'gesture' | 'menu';
  suppressed: boolean;
}

export interface InstallPackageRequest {
  path: string;
}

export interface InstallPackageResponse {
  success: boolean;
  error?: string;
}

export interface SetSystemUIVisibilityRequest {
  visible: boolean;
  darkMode: boolean;
}

export interface SetSystemUIVisibilityResponse {
  success: boolean;
  error?: string;
}

export interface GetStatusBarHeightResponse {
  height: number;
  error?: string;
}

export interface GetSystemFontsListResponse {
  fonts: Record<string, string>; // { fontName: fontFamily }
  error?: string;
}

export interface InterceptKeysRequest {
  volumeKeys?: boolean;
  backKey?: boolean;
  /** Intercept media keys (next/previous/play-pause) for the hardware page turner. */
  pageTurnerKeys?: boolean;
  /** Forward every key press to JS so the settings UI can capture a binding. */
  learnMode?: boolean;
}

export interface LockScreenRequest {
  orientation: 'portrait' | 'landscape' | 'auto';
}

export interface GetSystemColorSchemeResponse {
  colorScheme: 'light' | 'dark';
  error?: string;
}

export interface GetSafeAreaInsetsResponse {
  top: number;
  right: number;
  bottom: number;
  left: number;
  bottomCornerRadius?: number;
  isIPhoneDuo?: boolean;
  /** iOS: whether the root view controller currently hides the status bar. */
  statusBarHidden?: boolean;
  error?: string;
}

interface GetScreenBrightnessResponse {
  brightness: number; // 0.0 to 1.0
  error?: string;
}

interface SetScreenBrightnessRequest {
  brightness: number; // 0.0 to 1.0
  persist?: boolean; // iOS: keep the value as the system brightness, don't restore it
}

interface SetScreenBrightnessResponse {
  success: boolean;
  error?: string;
}

interface GetExternalSDCardPathResponse {
  path: string | null;
  error?: string;
}

interface SelectDirectoryResponse {
  cancelled?: boolean;
  uri?: string;
  path?: string;
  error?: string;
}

export interface GetStorefrontRegionCodeResponse {
  regionCode?: string;
  error?: string;
}

export interface RefreshEinkScreenResponse {
  success: boolean;
  error?: string;
}

export interface EinkRefreshSupportedResponse {
  supported: boolean;
}

export async function copyURIToPath(request: CopyURIRequest): Promise<CopyURIResponse> {
  const result = await invoke<CopyURIResponse>('plugin:native-bridge|copy_uri_to_path', {
    payload: request,
  });

  return result;
}

export async function saveImageToGallery(
  request: SaveImageToGalleryRequest,
): Promise<SaveImageToGalleryResponse> {
  return await invoke<SaveImageToGalleryResponse>('plugin:native-bridge|save_image_to_gallery', {
    payload: request,
  });
}

export async function invokeUseBackgroundAudio(request: UseBackgroundAudioRequest): Promise<void> {
  await invoke('plugin:native-bridge|use_background_audio', {
    payload: request,
  });
}

/**
 * Acquire or release the Android WifiManager MulticastLock so LocalSend
 * discovery announcements are delivered. Android only; a no-op elsewhere
 * (callers gate on isAndroidApp).
 */
export async function setMulticastLock(acquire: boolean): Promise<void> {
  await invoke('plugin:native-bridge|set_multicast_lock', {
    payload: { acquire },
  });
}

// Suppress a piece of the OS text-selection UI that would fight the reader's
// own selection UX:
//  - target 'gesture' (iOS): the system long-press selection for non-editable
//    content, while the instant-highlight quick action owns the hold. WebKit
//    consults selectability before any touch handler runs, so JS-level
//    suppression cannot win that race.
//  - target 'menu' (Android, #5427): the floating selection ActionMode
//    (Copy / Share / Select all), so it can't cover Readest's annotation
//    toolbar. Chromium shows it through paths that never fire a cancelable
//    `contextmenu` event, so DOM-level preventDefault can't stop it;
//    MainActivity refuses floating action modes while this flag is set.
export async function setSelectionSuppressed(
  request: SetSelectionSuppressedRequest,
): Promise<void> {
  await invoke('plugin:native-bridge|set_selection_suppressed', {
    payload: request,
  });
}

export async function installPackage(
  request: InstallPackageRequest,
): Promise<InstallPackageResponse> {
  const result = await invoke<InstallPackageResponse>('plugin:native-bridge|install_package', {
    payload: request,
  });
  return result;
}

export async function setSystemUIVisibility(
  request: SetSystemUIVisibilityRequest,
): Promise<SetSystemUIVisibilityResponse> {
  const result = await invoke<SetSystemUIVisibilityResponse>(
    'plugin:native-bridge|set_system_ui_visibility',
    {
      payload: request,
    },
  );
  return result;
}

export async function getStatusBarHeight(): Promise<GetStatusBarHeightResponse> {
  const result = await invoke<GetStatusBarHeightResponse>(
    'plugin:native-bridge|get_status_bar_height',
  );
  return result;
}

let cachedSysFontsResult: GetSystemFontsListResponse | null = null;

export async function getSysFontsList(): Promise<GetSystemFontsListResponse> {
  if (cachedSysFontsResult) {
    return cachedSysFontsResult;
  }
  const result = await invoke<GetSystemFontsListResponse>(
    'plugin:native-bridge|get_sys_fonts_list',
  );
  cachedSysFontsResult = result;
  return result;
}

export async function interceptKeys(request: InterceptKeysRequest): Promise<void> {
  await invoke('plugin:native-bridge|intercept_keys', {
    payload: request,
  });
}

export async function lockScreenOrientation(request: LockScreenRequest): Promise<void> {
  await invoke('plugin:native-bridge|lock_screen_orientation', {
    payload: request,
  });
}

export async function getSystemColorScheme(): Promise<GetSystemColorSchemeResponse> {
  const result = await invoke<GetSystemColorSchemeResponse>(
    'plugin:native-bridge|get_system_color_scheme',
  );
  return result;
}

export async function getSafeAreaInsets(): Promise<GetSafeAreaInsetsResponse> {
  const result = await invoke<GetSafeAreaInsetsResponse>(
    'plugin:native-bridge|get_safe_area_insets',
  );
  return result;
}

export async function setScreenWakeLock(enabled: boolean): Promise<void> {
  await invoke('plugin:native-bridge|set_screen_wake_lock', { payload: { enabled } });
}

export async function getScreenBrightness(): Promise<GetScreenBrightnessResponse> {
  const result = await invoke<GetScreenBrightnessResponse>(
    'plugin:native-bridge|get_screen_brightness',
  );
  return result;
}

export async function setScreenBrightness(
  request: SetScreenBrightnessRequest,
): Promise<SetScreenBrightnessResponse> {
  const result = await invoke<SetScreenBrightnessResponse>(
    'plugin:native-bridge|set_screen_brightness',
    {
      payload: request,
    },
  );
  return result;
}

export interface HasAmbientLightSensorResponse {
  available: boolean;
  error?: string;
}

export interface AmbientLightUpdatesResponse {
  success: boolean;
  error?: string;
}

export interface AmbientLightPayload {
  lux: number;
}

export async function hasAmbientLightSensor(): Promise<HasAmbientLightSensorResponse> {
  return invoke<HasAmbientLightSensorResponse>('plugin:native-bridge|has_ambient_light_sensor');
}

export async function startAmbientLightUpdates(): Promise<AmbientLightUpdatesResponse> {
  return invoke<AmbientLightUpdatesResponse>('plugin:native-bridge|start_ambient_light_updates');
}

export async function stopAmbientLightUpdates(): Promise<AmbientLightUpdatesResponse> {
  return invoke<AmbientLightUpdatesResponse>('plugin:native-bridge|stop_ambient_light_updates');
}

export async function getExternalSDCardPath(): Promise<GetExternalSDCardPathResponse> {
  const result = await invoke<GetExternalSDCardPathResponse>(
    'plugin:native-bridge|get_external_sdcard_path',
  );
  return result;
}

export async function selectDirectory(): Promise<SelectDirectoryResponse> {
  const result = await invoke<SelectDirectoryResponse>('plugin:native-bridge|select_directory');
  return result;
}

// Android only. Opens the system document picker fire-and-forget; the picked
// URIs come back as a `file-picker-result` plugin event (see
// useAndroidPickedBooks) so they survive the activity/process being torn down
// while the picker is in the foreground (#1217).
export async function showFilePicker(): Promise<void> {
  await invoke('plugin:native-bridge|show_file_picker');
}

export async function getStorefrontRegionCode(): Promise<GetStorefrontRegionCodeResponse> {
  const result = await invoke<GetStorefrontRegionCodeResponse>(
    'plugin:native-bridge|get_storefront_region_code',
  );
  return result;
}

/**
 * Trigger a deep e-ink full screen refresh (GC / GC16 waveform) to clear
 * ghosting. Android-only; the native side probes several vendor mechanisms
 * via reflection and returns `success: false` on devices with no e-ink
 * controller. Other platforms reject with an unsupported-platform error.
 */
export async function refreshEinkScreen(): Promise<RefreshEinkScreenResponse> {
  return await invoke<RefreshEinkScreenResponse>('plugin:native-bridge|refresh_eink_screen');
}

/**
 * Whether this device exposes a deep e-ink full-refresh mechanism we can
 * drive (Onyx / NTX / Rockchip / Hanvon vendor hooks). Android-only; the native
 * side resolves the probe read-only (class reflection plus a system-service
 * lookup) — it never flashes the panel — so it is safe to call once at startup
 * to decide whether to offer the "Auto Full Refresh" / "Refresh Page" options.
 * Non-e-ink devices and other platforms report `supported: false`.
 */
export async function isEinkRefreshSupported(): Promise<boolean> {
  const response = await invoke<EinkRefreshSupportedResponse>(
    'plugin:native-bridge|is_eink_refresh_supported',
  );
  return response.supported;
}

// Memoized so the capability probe — a one-shot, read-only query against the
// vendor hooks — runs a single time per app session, no matter how many
// settings surfaces read it. Only a successful probe is cached: a transient
// rejection (e.g. the bridge not ready on first mount) clears the cache so a
// later call can retry, instead of latching the option hidden for the session.
let einkRefreshSupportedPromise: Promise<boolean> | null = null;
let einkRefreshSupportedSettled: boolean | null = null;
export function checkEinkRefreshSupported(): Promise<boolean> {
  if (!einkRefreshSupportedPromise) {
    einkRefreshSupportedPromise = isEinkRefreshSupported().then(
      (supported) => {
        einkRefreshSupportedSettled = supported;
        return supported;
      },
      (error) => {
        // A rejection is inconclusive (bridge not ready / native probe error),
        // NOT a confirmed 'no hook': the command only rejects on a hard
        // reflection failure. Drop the cache so a later call retries, and log
        // why so the field case is distinguishable from a genuine negative.
        console.error('eink refresh capability probe inconclusive, will retry:', error);
        einkRefreshSupportedPromise = null;
        return false;
      },
    );
  }
  return einkRefreshSupportedPromise;
}

// Synchronous view of a settled probe (`null` = not yet resolved). Lets the
// auto-refresh loop skip the guaranteed no-op call on a device the probe
// authoritatively ruled out, without awaiting. A false here only ever comes
// from the probe itself, never from a refresh outcome — runtime misses on a
// supported device are transient and must not disable the feature.
export function getCachedEinkRefreshSupported(): boolean | null {
  return einkRefreshSupportedSettled;
}

/** Webview region to snapshot, in CSS pixels of the viewport (origin top-left). */
export interface CaptureWebviewRegionRequest {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Capture a region of the running webview for the mesh page-curl texture
 * (#555): PNG bytes on macOS, JPEG bytes on iOS/Android (phone-CPU PNG
 * encoding took ~1.5s per turn), taken at screen scale and capped at 2x CSS
 * pixels on mobile. Windows and the Linux CEF runtime capture the whole view
 * as JPEG (DevTools `Page.captureScreenshot`; its clip flashes the live view)
 * and the region is cropped out here while decoding, so they resolve to a
 * bitmap. Rejects where there is no native capture (web, the Linux WebKitGTK
 * test runtime), and callers fall back to the renderer's own turns.
 */
export async function captureWebviewRegion(
  request: CaptureWebviewRegionRequest,
): Promise<ArrayBuffer | ImageBitmap> {
  const image = await invoke<ArrayBuffer>('plugin:native-bridge|capture_webview_region', {
    payload: request,
  });
  const os = getOSPlatform();
  if (os !== 'windows' && os !== 'linux') return image;
  const scale = window.devicePixelRatio;
  return await createImageBitmap(
    new Blob([image]),
    Math.round(request.x * scale),
    Math.round(request.y * scale),
    Math.round(request.width * scale),
    Math.round(request.height * scale),
  );
}

export interface CoverWebviewRegionResponse {
  token: number;
}

/**
 * Freeze the on-screen pixels of a webview region behind a native snapshot
 * view that `captureWebviewRegion` does not see (iOS only so far). The
 * two-column page curl uses it to capture the incoming column under its
 * overlay without ever showing it (#6106). Rejects where unimplemented.
 */
export async function coverWebviewRegion(
  request: CaptureWebviewRegionRequest,
): Promise<CoverWebviewRegionResponse> {
  return await invoke<CoverWebviewRegionResponse>('plugin:native-bridge|cover_webview_region', {
    payload: request,
  });
}

/** Remove the cover put up by `coverWebviewRegion`; stale tokens are ignored. */
export async function uncoverWebviewRegion(request: { token: number }): Promise<void> {
  await invoke('plugin:native-bridge|uncover_webview_region', { payload: request });
}

// ── Sync passphrase keychain ────────────────────────────────────────────
// Tauri-only. Wired into the TauriPassphraseStore (src/libs/crypto/
// passphrase.ts) so the user's sync passphrase persists across app
// launches via the OS keychain (macOS Keychain, Windows Credential
// Manager, Linux libsecret, iOS Keychain, Android EncryptedSharedPrefs).

export interface SetSyncPassphraseRequest {
  passphrase: string;
}

export interface SyncPassphraseResponse {
  success: boolean;
  error?: string;
}

export interface GetSyncPassphraseResponse {
  passphrase?: string;
  error?: string;
}

export interface SyncKeychainAvailableResponse {
  available: boolean;
  error?: string;
}

export async function setSyncPassphrase(
  request: SetSyncPassphraseRequest,
): Promise<SyncPassphraseResponse> {
  return invoke<SyncPassphraseResponse>('plugin:native-bridge|set_sync_passphrase', {
    payload: request,
  });
}

export async function getSyncPassphrase(): Promise<GetSyncPassphraseResponse> {
  return invoke<GetSyncPassphraseResponse>('plugin:native-bridge|get_sync_passphrase');
}

export async function clearSyncPassphrase(): Promise<SyncPassphraseResponse> {
  return invoke<SyncPassphraseResponse>('plugin:native-bridge|clear_sync_passphrase');
}

export async function isSyncKeychainAvailable(): Promise<SyncKeychainAvailableResponse> {
  return invoke<SyncKeychainAvailableResponse>('plugin:native-bridge|is_sync_keychain_available');
}

// ── Keyed secure key-value store ─────────────────────────────────────────
// Tauri-only. A generic, keyed secret store over the same OS keychain backends
// as the sync passphrase above, so secrets that aren't the single sync
// passphrase (the Google Drive OAuth token set, and any future cloud
// provider's refresh token) get the same XSS-free cross-launch persistence
// without each needing its own native command. Availability is the same probe
// as `is_sync_keychain_available`.

export interface SetSecureItemRequest {
  key: string;
  value: string;
}

export interface GetSecureItemRequest {
  key: string;
}

export interface SecureItemResponse {
  success: boolean;
  error?: string;
}

export interface GetSecureItemResponse {
  value?: string;
  error?: string;
}

export async function setSecureItem(request: SetSecureItemRequest): Promise<SecureItemResponse> {
  return invoke<SecureItemResponse>('plugin:native-bridge|set_secure_item', { payload: request });
}

export async function getSecureItem(request: GetSecureItemRequest): Promise<GetSecureItemResponse> {
  return invoke<GetSecureItemResponse>('plugin:native-bridge|get_secure_item', {
    payload: request,
  });
}

export async function clearSecureItem(request: GetSecureItemRequest): Promise<SecureItemResponse> {
  return invoke<SecureItemResponse>('plugin:native-bridge|clear_secure_item', { payload: request });
}

// ── Bookshelf widget ────────────────────────────────────────────────────────

export interface BookshelfWidgetBookPayload {
  hash: string;
  title: string;
  author: string;
  percent: number;
  showProgress: boolean;
  coverPath: string;
}

export interface BookshelfWidgetTts {
  active: boolean;
  playing: boolean;
}

/** A group tile: a mosaic of up to 4 member covers (see
 * buildBookshelfWidgetItems in services/widget/bookshelfWidget.ts). */
export interface BookshelfWidgetGroupPayload {
  id: string;
  groupBy: string;
  value: string;
  coverPaths: string[];
}

/** One grid tile: a book or a group. */
export type BookshelfWidgetItemPayload =
  | ({ type: 'book' } & BookshelfWidgetBookPayload)
  | ({ type: 'group' } & BookshelfWidgetGroupPayload);

export interface UpdateBookshelfWidgetRequest {
  appWidgetId: number;
  /** The shelf the widget asked for; native shows a placeholder until they match. */
  shelfId: string;
  /** Grid tiles in display order. */
  items: BookshelfWidgetItemPayload[];
  sectionTitle: string;
  emptyTitle: string;
  tts?: BookshelfWidgetTts;
}

/** `failed` counts tiles whose cover was missing or unusable (0 on iOS/desktop). */
export async function updateBookshelfWidget(
  request: UpdateBookshelfWidgetRequest,
): Promise<{ failed: number }> {
  return invoke('plugin:native-bridge|update_bookshelf_widget', { payload: request });
}

/** A placed widget, as chosen in its native configure screen. */
export interface BookshelfWidgetInstance {
  appWidgetId: number;
  shelfId: string;
  gridRows: number;
  gridColumns: number;
}

export interface GetBookshelfWidgetInstancesResponse {
  instances: BookshelfWidgetInstance[];
}

export async function getBookshelfWidgetInstances(): Promise<GetBookshelfWidgetInstancesResponse> {
  return invoke<GetBookshelfWidgetInstancesResponse>(
    'plugin:native-bridge|get_bookshelf_widget_instances',
  );
}

/** What the native configure screen offers, translated, since it can't read the app's settings. */
export interface BookshelfWidgetCatalog {
  shelves: { id: string; name: string }[];
  labels: {
    title: string;
    rows: string;
    columns: string;
    showTitles: string;
    showShelfName: string;
    headerSize: string;
    showTtsBar: string;
    cancel: string;
    save: string;
    /** Opens the app to edit the selected shelf (readest://widget-edit-shelf/{id}). */
    edit: string;
    /** Shown on a widget whose shelf hasn't been loaded by the app yet. */
    openApp: string;
  };
}

export async function setBookshelfWidgetCatalog(catalog: BookshelfWidgetCatalog): Promise<void> {
  await invoke('plugin:native-bridge|set_bookshelf_widget_catalog', { payload: catalog });
}

// ── Reading widget ──────────────────────────────────────────────────────────

export interface UpdateReadingWidgetRequest {
  appWidgetId: number;
  /** Empty means "nothing currently reading". */
  hash: string;
  title: string;
  author: string;
  /** Numeric value for the progress bar. */
  percent: number;
  coverPath: string;
  /** The text stats to show, in order (already localized); native lays them out in a row. */
  stats: string[];
  headerText: string;
  emptyTitle: string;
  /** Draws the text and progress bar in black. */
  isEink: boolean;
  tts?: BookshelfWidgetTts;
}

/** `failed` is 1 when the cover couldn't be written (0 on iOS/desktop). */
export async function updateReadingWidget(
  request: UpdateReadingWidgetRequest,
): Promise<{ failed: number }> {
  return invoke('plugin:native-bridge|update_reading_widget', { payload: request });
}

export interface ReadingWidgetInstance {
  appWidgetId: number;
  showTimeLeft: boolean;
  showPageCount: boolean;
  showPagesRemaining: boolean;
  showHeader: boolean;
  showPercent: boolean;
  referencePages: boolean;
}

interface GetReadingWidgetInstancesResponse {
  instances: ReadingWidgetInstance[];
}

export async function getReadingWidgetInstances(): Promise<GetReadingWidgetInstancesResponse> {
  return invoke<GetReadingWidgetInstancesResponse>(
    'plugin:native-bridge|get_reading_widget_instances',
  );
}

/** Translated labels for the native configure screen, which can't read the app's settings. */
export interface ReadingWidgetCatalog {
  labels: {
    title: string;
    showHeader: string;
    headerSize: string;
    showTtsBar: string;
    showPercent: string;
    referencePages: string;
    showTimeLeft: string;
    showPageCount: string;
    showPagesRemaining: string;
    textSize: string;
    cancel: string;
    save: string;
  };
}

export async function setReadingWidgetCatalog(catalog: ReadingWidgetCatalog): Promise<void> {
  await invoke('plugin:native-bridge|set_reading_widget_catalog', { payload: catalog });
}

// ── Nightly updater (main-app commands, no native-bridge prefix) ─────────
// `verify_update_signature` gates the custom install flows (portable /
// AppImage / Android); `install_nightly_update` drives the Tauri updater for
// the platform keys it natively installs (macOS / Windows-NSIS).

export async function verifyUpdateSignature(
  path: string,
  signature: string,
  pubKey: string,
): Promise<boolean> {
  return invoke<boolean>('verify_update_signature', { path, signature, pubKey });
}

export interface NightlyProgress {
  event: 'progress' | 'finished';
  downloaded: number;
  contentLength: number;
}

export async function installNightlyUpdate(
  endpoint: string,
  onProgress?: (p: NightlyProgress) => void,
): Promise<void> {
  const channel = new Channel<NightlyProgress>();
  if (onProgress) channel.onmessage = onProgress;
  await invoke<void>('install_nightly_update', { endpoint, channel });
}

export interface ICloudContainerStatusResponse {
  available: boolean;
  documentsPath?: string;
}

export interface ICloudEnsureDownloadedRequest {
  path: string;
  timeoutMs?: number;
}

export interface ICloudEnsureDownloadedResponse {
  status: 'ready' | 'notFound' | 'timeout';
}

export async function getICloudContainerStatus(): Promise<ICloudContainerStatusResponse> {
  return invoke<ICloudContainerStatusResponse>('plugin:native-bridge|icloud_container_status');
}

export async function icloudEnsureDownloaded(
  request: ICloudEnsureDownloadedRequest,
): Promise<ICloudEnsureDownloadedResponse> {
  return invoke<ICloudEnsureDownloadedResponse>('plugin:native-bridge|icloud_ensure_downloaded', {
    payload: request,
  });
}
