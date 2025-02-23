use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_safari_auth);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SafariAuth<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_safari_auth)?;
    Ok(SafariAuth(handle))
}

/// Access to the safari-auth APIs.
pub struct SafariAuth<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SafariAuth<R> {
    pub fn auth_with_safari(
        &self,
        payload: SafariAuthRequest,
    ) -> crate::Result<SafariAuthResponse> {
        self.0
            .run_mobile_plugin("auth_with_safari", payload)
            .map_err(Into::into)
    }
}
