use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::Result;
use crate::SafariAuthExt;

#[command]
pub(crate) async fn auth_with_safari<R: Runtime>(
    app: AppHandle<R>,
    payload: SafariAuthRequest,
) -> Result<SafariAuthResponse> {
    app.safari_auth().auth_with_safari(payload)
}
