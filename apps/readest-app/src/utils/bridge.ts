import { invoke, Channel } from '@tauri-apps/api/core';

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
  error?: string;
}

interface GetScreenBrightnessResponse {
  brightness: number; // 0.0 to 1.0
  error?: string;
}

interface SetScreenBrightnessRequest {
  brightness: number; // 0.0 to 1.0
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

/** Webview region to snapshot, in CSS pixels of the viewport (origin top-left). */
export interface CaptureWebviewRegionRequest {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Capture a region of the running webview as compressed image bytes for
 * the mesh page-curl texture (#555): PNG on iOS/macOS, JPEG on Android
 * (phone-CPU PNG encoding took ~1.5s per turn). The snapshot is taken at
 * screen scale, capped at 2x CSS pixels on Android. Rejects on platforms
 * without a native capture implementation (web, Windows/Linux so far) —
 * callers fall back to the CSS curl.
 */
export async function captureWebviewRegion(
  request: CaptureWebviewRegionRequest,
): Promise<ArrayBuffer> {
  return await invoke<ArrayBuffer>('plugin:native-bridge|capture_webview_region', {
    payload: request,
  });
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

// ── Reading widget ────────────────────────────────────────────────────────

export interface ReadingWidgetBookPayload {
  hash: string;
  title: string;
  author: string;
  percent: number;
  coverPath: string;
}

export interface ReadingWidgetTts {
  active: boolean;
  playing: boolean;
}

export interface UpdateReadingWidgetRequest {
  books: ReadingWidgetBookPayload[];
  sectionTitle: string;
  emptyTitle: string;
  tts?: ReadingWidgetTts;
}

export async function updateReadingWidget(request: UpdateReadingWidgetRequest): Promise<void> {
  await invoke('plugin:native-bridge|update_reading_widget', { payload: request });
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
