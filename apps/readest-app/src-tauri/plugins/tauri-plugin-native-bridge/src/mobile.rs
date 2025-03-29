use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_bridge);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NativeBridge<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.readest.native_bridge", "NativeBridgePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_native_bridge)?;
    Ok(NativeBridge(handle))
}

/// Access to the native-bridge APIs.
pub struct NativeBridge<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeBridge<R> {
    pub fn auth_with_safari(
        &self,
        payload: SafariAuthRequest,
    ) -> crate::Result<SafariAuthResponse> {
        self.0
            .run_mobile_plugin("auth_with_safari", payload)
            .map_err(Into::into)
    }
}
