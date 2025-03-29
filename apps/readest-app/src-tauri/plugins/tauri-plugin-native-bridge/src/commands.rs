use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeBridgeExt;
use crate::Result;

#[command]
pub(crate) async fn auth_with_safari<R: Runtime>(
    app: AppHandle<R>,
    payload: SafariAuthRequest,
) -> Result<SafariAuthResponse> {
    app.native_bridge().auth_with_safari(payload)
}
