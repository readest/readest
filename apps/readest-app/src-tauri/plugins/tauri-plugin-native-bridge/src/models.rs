use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    pub auth_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub redirect_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyURIRequest {
    pub uri: String,
    pub dst: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyURIResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageToGalleryRequest {
    /// Absolute path of the source image file on disk.
    pub src_path: String,
    /// Display name for the saved image, e.g. `image.png`.
    pub file_name: String,
    pub mime_type: String,
    /// Subfolder under the system Pictures collection. Defaults to `Readest`.
    pub album_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageToGalleryResponse {
    pub success: bool,
    /// MediaStore content URI of the saved image on success.
    pub uri: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UseBackgroundAudioRequest {
    pub enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageRequest {
    pub path: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSystemUIVisibilityRequest {
    pub visible: bool,
    pub dark_mode: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSystemUIVisibilityResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetStatusBarHeightResponse {
    pub height: u32,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSysFontsListResponse {
    pub fonts: HashMap<String, String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptKeysRequest {
    pub volume_keys: Option<bool>,
    pub back_key: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockScreenOrientationRequest {
    pub orientation: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub title: String,
    pub description: String,
    pub price: String,
    pub price_currency_code: Option<String>,
    pub price_amount_micros: i64,
    pub product_type: String, // "consumable", "non_consumable", or "subscription"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub platform: String, // "ios" or "android"
    pub package_name: Option<String>,
    pub product_id: String,
    pub transaction_id: Option<String>,
    pub original_transaction_id: Option<String>,
    pub order_id: Option<String>,
    pub purchase_token: Option<String>,
    pub purchase_date: String,
    pub purchase_state: String, // "purchased", "pending", "cancelled", "restored"
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPIsAvailableResponse {
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPInitializeRequest {
    pub public_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPInitializeResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPFetchProductsRequest {
    pub product_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPFetchProductsResponse {
    pub products: Vec<Product>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPPurchaseProductRequest {
    pub product_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPPurchaseProductResponse {
    pub purchase: Option<Purchase>,
    pub cancelled_purchase: Option<Purchase>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPRestorePurchasesResponse {
    pub purchases: Vec<Purchase>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSystemColorSchemeResponse {
    pub color_scheme: String, // "light" or "dark"
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSafeAreaInsetsResponse {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetScreenBrightnessResponse {
    pub brightness: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScreenBrightnessRequest {
    pub brightness: f64, // 0.0 to 1.0
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScreenBrightnessResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetExternalSDCardPathResponse {
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestManageStoragePermissionResponse {
    pub manage_storage: String, // "granted", "denied", or "prompt"
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlRequest {
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlResponse {
    pub success: bool,
    pub error: Option<String>,
}

/// Hand a word off to the platform's native dictionary surface.
///
/// On iOS this presents `UIReferenceLibraryViewController` modally
/// (the same UI Apple uses for `Look Up` in UIKit text views). On
/// Android it dispatches `ACTION_PROCESS_TEXT` so any installed
/// dictionary app (ColorDict, GoldenDict, 欧路, etc.) can handle the
/// word; we don't bind to a specific package so users can stick with
/// their preferred dictionary. Desktop platforms return
/// `UnsupportedPlatformError` — macOS goes through a separate native
/// command in `src/macos/system_dictionary.rs` that uses the AppKit
/// HUD surface, which doesn't exist on iOS/Android.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowLookupPopoverRequest {
    pub word: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowLookupPopoverResponse {
    pub success: bool,
    /// `unavailable` is set on Android when no app responded to the
    /// `ACTION_PROCESS_TEXT` intent (i.e. the user has no dictionary
    /// installed). The TS layer can surface a "no dictionary app"
    /// hint without us having to push a localized string from
    /// native code.
    pub unavailable: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectDirectoryResponse {
    pub cancelled: Option<bool>,
    pub uri: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetStorefrontRegionCodeResponse {
    pub region_code: Option<String>,
    pub error: Option<String>,
}

// ── Sync passphrase keychain ────────────────────────────────────────────
//
// Persist the sync passphrase across app launches via the OS keychain
// so native users don't re-enter it every session. The replica-sync
// CryptoSession (TS side) reads/writes via these commands; web users
// keep using the in-memory ephemeral store.

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSyncPassphraseRequest {
    pub passphrase: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPassphraseResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSyncPassphraseResponse {
    /// Present iff a passphrase is stored. Absent (and `error: None`)
    /// means "no entry on this device" — caller should prompt.
    pub passphrase: Option<String>,
    pub error: Option<String>,
}

/// Args for the mobile URL-clip flow. Mirrors the public `ClipOptions`
/// struct in `clip_url.rs` so the JS caller can pass the same payload
/// to both desktop and mobile without branching. The native side honors
/// `background`/`foreground` for the overlay backdrop and `windowTitle`/
/// `overlayTitle`/`loadingStatus`/`capturingStatus`/`savedTitle` for the
/// chrome and progress labels.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipUrlRequest {
    pub url: String,
    #[serde(default)]
    pub window_title: Option<String>,
    #[serde(default)]
    pub overlay_title: Option<String>,
    #[serde(default)]
    pub loading_status: Option<String>,
    #[serde(default)]
    pub capturing_status: Option<String>,
    #[serde(default)]
    pub saved_title: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub foreground: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipUrlResponse {
    /// Rendered `document.documentElement.outerHTML` captured from the
    /// hidden WKWebView / WebView once load+settle completed.
    pub html: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncKeychainAvailableResponse {
    pub available: bool,
    pub error: Option<String>,
}

// ── Keyed secure key-value store ─────────────────────────────────────────
//
// A generic, keyed secret store over the same OS keychain backends as the
// sync passphrase above, so secrets that aren't the single sync passphrase
// (the Google Drive OAuth token set, and any future cloud provider's refresh
// token) get the same cross-launch persistence without each needing its own
// native command.

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSecureItemRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSecureItemRequest {
    pub key: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureItemResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSecureItemResponse {
    /// Present iff an item is stored under the key. Absent (and `error: None`)
    /// means "no entry on this device".
    pub value: Option<String>,
    pub error: Option<String>,
}

/// Result of a deep e-ink full screen refresh. `success: false` means no
/// known e-ink controller responded on this device (e.g. a non-e-ink
/// Android phone) — not a hard error.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshEinkScreenResponse {
    pub success: bool,
    pub error: Option<String>,
}
