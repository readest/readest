use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime, State};

use crate::models::*;
use crate::DirectoryCallbackState;
use crate::NativeBridgeExt;
use crate::Result;

#[command]
pub(crate) async fn auth_with_safari<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthRequest,
) -> Result<AuthResponse> {
    app.native_bridge().auth_with_safari(payload)
}

#[command]
pub(crate) async fn auth_with_custom_tab<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthRequest,
) -> Result<AuthResponse> {
    app.native_bridge().auth_with_custom_tab(payload)
}

#[command]
pub(crate) async fn copy_uri_to_path<R: Runtime>(
    app: AppHandle<R>,
    payload: CopyURIRequest,
) -> Result<CopyURIResponse> {
    app.native_bridge().copy_uri_to_path(payload)
}

#[command]
pub(crate) async fn use_background_audio<R: Runtime>(
    app: AppHandle<R>,
    payload: UseBackgroundAudioRequest,
) -> Result<()> {
    app.native_bridge().use_background_audio(payload)
}

#[command]
pub(crate) async fn install_package<R: Runtime>(
    app: AppHandle<R>,
    payload: InstallPackageRequest,
) -> Result<InstallPackageResponse> {
    app.native_bridge().install_package(payload)
}

#[command]
pub(crate) async fn set_system_ui_visibility<R: Runtime>(
    app: AppHandle<R>,
    payload: SetSystemUIVisibilityRequest,
) -> Result<SetSystemUIVisibilityResponse> {
    app.native_bridge().set_system_ui_visibility(payload)
}

#[command]
pub(crate) async fn get_status_bar_height<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetStatusBarHeightResponse> {
    app.native_bridge().get_status_bar_height()
}

#[command]
pub(crate) async fn get_sys_fonts_list<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSysFontsListResponse> {
    app.native_bridge().get_sys_fonts_list()
}

#[command]
pub(crate) async fn intercept_keys<R: Runtime>(
    app: AppHandle<R>,
    payload: InterceptKeysRequest,
) -> Result<()> {
    app.native_bridge().intercept_keys(payload)
}

#[command]
pub(crate) async fn lock_screen_orientation<R: Runtime>(
    app: AppHandle<R>,
    payload: LockScreenOrientationRequest,
) -> Result<()> {
    app.native_bridge().lock_screen_orientation(payload)
}

#[command]
pub(crate) async fn iap_is_available<R: Runtime>(
    app: AppHandle<R>,
) -> Result<IAPIsAvailableResponse> {
    app.native_bridge().iap_is_available()
}

#[command]
pub(crate) async fn iap_initialize<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPInitializeRequest,
) -> Result<IAPInitializeResponse> {
    app.native_bridge().iap_initialize(payload)
}

#[command]
pub(crate) async fn iap_fetch_products<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPFetchProductsRequest,
) -> Result<IAPFetchProductsResponse> {
    app.native_bridge().iap_fetch_products(payload)
}

#[command]
pub(crate) async fn iap_purchase_product<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPPurchaseProductRequest,
) -> Result<IAPPurchaseProductResponse> {
    app.native_bridge().iap_purchase_product(payload)
}

#[command]
pub(crate) async fn iap_restore_purchases<R: Runtime>(
    app: AppHandle<R>,
) -> Result<IAPRestorePurchasesResponse> {
    app.native_bridge().iap_restore_purchases()
}

#[command]
pub(crate) async fn get_system_color_scheme<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSystemColorSchemeResponse> {
    app.native_bridge().get_system_color_scheme()
}

#[command]
pub(crate) async fn get_safe_area_insets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSafeAreaInsetsResponse> {
    app.native_bridge().get_safe_area_insets()
}

#[command]
pub(crate) async fn get_screen_brightness<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetScreenBrightnessResponse> {
    app.native_bridge().get_screen_brightness()
}

#[command]
pub(crate) async fn set_screen_brightness<R: Runtime>(
    app: AppHandle<R>,
    payload: SetScreenBrightnessRequest,
) -> Result<SetScreenBrightnessResponse> {
    app.native_bridge().set_screen_brightness(payload)
}

#[command]
pub(crate) async fn get_external_sdcard_path<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetExternalSDCardPathResponse> {
    app.native_bridge().get_external_sdcard_path()
}

#[command]
pub(crate) async fn open_external_url<R: Runtime>(
    app: AppHandle<R>,
    payload: OpenExternalUrlRequest,
) -> Result<OpenExternalUrlResponse> {
    app.native_bridge().open_external_url(payload)
}

#[command]
pub(crate) async fn select_directory<R: Runtime>(
    app: AppHandle<R>,
    callback_state: State<'_, DirectoryCallbackState<R>>,
) -> Result<SelectDirectoryResponse> {
    let result = app.native_bridge().select_directory()?;

    if let Some(dir_path) = &result.path {
        let path = PathBuf::from(dir_path);

        if let Ok(callback_guard) = callback_state.callback.lock() {
            if let Some(callback) = callback_guard.as_ref() {
                callback(&app, &path);
            }
        }
    }

    Ok(result)
}

#[command]
pub(crate) async fn request_manage_storage_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RequestManageStoragePermissionResponse> {
    app.native_bridge().request_manage_storage_permission()
}
