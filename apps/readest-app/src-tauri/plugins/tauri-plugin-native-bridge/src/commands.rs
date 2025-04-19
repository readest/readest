use tauri::{command, AppHandle, Runtime};

use crate::models::*;
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
