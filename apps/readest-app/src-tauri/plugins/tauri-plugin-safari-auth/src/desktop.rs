use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SafariAuth<R>> {
    Ok(SafariAuth(app.clone()))
}

/// Access to the safari-auth APIs.
pub struct SafariAuth<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SafariAuth<R> {
    pub fn auth_with_safari(
        &self,
        _payload: SafariAuthRequest,
    ) -> crate::Result<SafariAuthResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}
