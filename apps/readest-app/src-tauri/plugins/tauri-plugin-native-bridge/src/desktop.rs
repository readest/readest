use serde::de::DeserializeOwned;
use std::collections::HashMap;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NativeBridge<R>> {
    // keyring v4 split the library into `keyring-core` plus a
    // per-platform credential-store crate. The default store is a
    // process-wide global that must be installed before the first
    // `Entry::new` call. `set_default_store` is idempotent — calling
    // it again on plugin re-init just replaces the previous handle.
    // We log and swallow errors so a misconfigured keychain doesn't
    // block plugin init; downstream calls then fail with NoDefaultStore
    // and the TS layer falls back to the ephemeral store.
    install_default_keyring_store();
    Ok(NativeBridge(app.clone()))
}

#[cfg(target_os = "macos")]
fn install_default_keyring_store() {
    match apple_native_keyring_store::keychain::Store::new() {
        Ok(store) => keyring_core::set_default_store(store),
        Err(err) => eprintln!("[native-bridge] keychain store init failed: {err}"),
    }
}

#[cfg(target_os = "windows")]
fn install_default_keyring_store() {
    match windows_native_keyring_store::Store::new() {
        Ok(store) => keyring_core::set_default_store(store),
        Err(err) => eprintln!("[native-bridge] credential manager init failed: {err}"),
    }
}

#[cfg(target_os = "linux")]
fn install_default_keyring_store() {
    match dbus_secret_service_keyring_store::Store::new() {
        Ok(store) => keyring_core::set_default_store(store),
        Err(err) => eprintln!("[native-bridge] secret service init failed: {err}"),
    }
}

/// Access to the native-bridge APIs.
pub struct NativeBridge<R: Runtime>(AppHandle<R>);

impl<R: Runtime> NativeBridge<R> {
    pub fn auth_with_safari(&self, _payload: AuthRequest) -> crate::Result<AuthResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn auth_with_custom_tab(&self, _payload: AuthRequest) -> crate::Result<AuthResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn copy_uri_to_path(&self, _payload: CopyURIRequest) -> crate::Result<CopyURIResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn use_background_audio(&self, _payload: UseBackgroundAudioRequest) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn install_package(
        &self,
        _payload: InstallPackageRequest,
    ) -> crate::Result<InstallPackageResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn set_system_ui_visibility(
        &self,
        _payload: SetSystemUIVisibilityRequest,
    ) -> crate::Result<SetSystemUIVisibilityResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_status_bar_height(&self) -> crate::Result<GetStatusBarHeightResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_sys_fonts_list(&self) -> crate::Result<GetSysFontsListResponse> {
        let font_collection = font_enumeration::Collection::new().unwrap();
        let mut fonts = HashMap::new();
        for font in font_collection.all() {
            if cfg!(target_os = "windows") {
                // FIXME: temporarily disable font name with style for windows
                fonts.insert(font.family_name.clone(), font.family_name.clone());
            } else {
                fonts.insert(font.font_name.clone(), font.family_name.clone());
            }
        }
        Ok(GetSysFontsListResponse { fonts, error: None })
    }

    pub fn intercept_keys(&self, _payload: InterceptKeysRequest) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn lock_screen_orientation(
        &self,
        _payload: LockScreenOrientationRequest,
    ) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn iap_is_available(&self) -> crate::Result<IAPIsAvailableResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn iap_initialize(
        &self,
        _payload: IAPInitializeRequest,
    ) -> crate::Result<IAPInitializeResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn iap_fetch_products(
        &self,
        _payload: IAPFetchProductsRequest,
    ) -> crate::Result<IAPFetchProductsResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn iap_purchase_product(
        &self,
        _payload: IAPPurchaseProductRequest,
    ) -> crate::Result<IAPPurchaseProductResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn iap_restore_purchases(&self) -> crate::Result<IAPRestorePurchasesResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_system_color_scheme(&self) -> crate::Result<GetSystemColorSchemeResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_safe_area_insets(&self) -> crate::Result<GetSafeAreaInsetsResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_screen_brightness(&self) -> crate::Result<GetScreenBrightnessResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn set_screen_brightness(
        &self,
        _payload: SetScreenBrightnessRequest,
    ) -> crate::Result<SetScreenBrightnessResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_external_sdcard_path(&self) -> crate::Result<GetExternalSDCardPathResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn open_external_url(
        &self,
        _payload: OpenExternalUrlRequest,
    ) -> crate::Result<OpenExternalUrlResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn select_directory(&self) -> crate::Result<SelectDirectoryResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn get_storefront_region_code(&self) -> crate::Result<GetStorefrontRegionCodeResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    pub fn request_manage_storage_permission(
        &self,
    ) -> crate::Result<RequestManageStoragePermissionResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }

    // ── Sync passphrase keychain ────────────────────────────────────────
    //
    // Uses `keyring-core` v1 with a platform-specific credential store
    // installed in `init()` above:
    //   * macOS → Security framework Keychain (apple-native-keyring-store)
    //   * Windows → Credential Manager (windows-native-keyring-store)
    //   * Linux → Secret Service (dbus-secret-service-keyring-store)
    //
    // `service` and `user` form the keychain item identity. Service is
    // the bundle id; user is a stable string ("default") so multiple
    // Readest installs on the same machine could coexist with distinct
    // user values if ever needed.

    pub fn set_sync_passphrase(
        &self,
        payload: SetSyncPassphraseRequest,
    ) -> crate::Result<SyncPassphraseResponse> {
        match keyring_entry().and_then(|e| e.set_password(&payload.passphrase)) {
            Ok(()) => Ok(SyncPassphraseResponse {
                success: true,
                error: None,
            }),
            Err(err) => Ok(SyncPassphraseResponse {
                success: false,
                error: Some(err.to_string()),
            }),
        }
    }

    pub fn get_sync_passphrase(&self) -> crate::Result<GetSyncPassphraseResponse> {
        match keyring_entry().and_then(|e| e.get_password()) {
            Ok(passphrase) => Ok(GetSyncPassphraseResponse {
                passphrase: Some(passphrase),
                error: None,
            }),
            Err(keyring_core::Error::NoEntry) => Ok(GetSyncPassphraseResponse {
                passphrase: None,
                error: None,
            }),
            Err(err) => Ok(GetSyncPassphraseResponse {
                passphrase: None,
                error: Some(err.to_string()),
            }),
        }
    }

    pub fn clear_sync_passphrase(&self) -> crate::Result<SyncPassphraseResponse> {
        match keyring_entry().and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(SyncPassphraseResponse {
                success: true,
                error: None,
            }),
            Err(err) => Ok(SyncPassphraseResponse {
                success: false,
                error: Some(err.to_string()),
            }),
        }
    }

    pub fn is_sync_keychain_available(&self) -> crate::Result<SyncKeychainAvailableResponse> {
        // Best-effort probe: open an entry handle. Surface the error
        // string instead of throwing so the TS layer can fall back
        // to the ephemeral store gracefully.
        match keyring_entry() {
            Ok(_) => Ok(SyncKeychainAvailableResponse {
                available: true,
                error: None,
            }),
            Err(err) => Ok(SyncKeychainAvailableResponse {
                available: false,
                error: Some(err.to_string()),
            }),
        }
    }
}

const KEYRING_SERVICE: &str = "Readest Safe Storage";
const KEYRING_USER: &str = "default";

fn keyring_entry() -> std::result::Result<keyring_core::Entry, keyring_core::Error> {
    keyring_core::Entry::new(KEYRING_SERVICE, KEYRING_USER)
}
