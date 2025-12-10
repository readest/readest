use std::sync::{Arc, Mutex};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;
mod platform;

pub use error::{Error, Result};

use std::path::PathBuf;
use tauri::AppHandle;

#[cfg(desktop)]
use desktop::NativeBridge;
#[cfg(mobile)]
use mobile::NativeBridge;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the native-bridge APIs.
pub trait NativeBridgeExt<R: Runtime> {
    fn native_bridge(&self) -> &NativeBridge<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NativeBridgeExt<R> for T {
    fn native_bridge(&self) -> &NativeBridge<R> {
        self.state::<NativeBridge<R>>().inner()
    }
}

type DirectoryCallback<R> = Box<dyn Fn(&AppHandle<R>, &PathBuf) + Send + Sync>;

pub struct DirectoryCallbackState<R: Runtime> {
    pub callback: Arc<Mutex<Option<DirectoryCallback<R>>>>,
}

impl<R: Runtime> Default for DirectoryCallbackState<R> {
    fn default() -> Self {
        Self {
            callback: Arc::new(Mutex::new(None)),
        }
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-bridge")
        .invoke_handler(tauri::generate_handler![
            commands::auth_with_safari,
            commands::auth_with_custom_tab,
            commands::copy_uri_to_path,
            commands::use_background_audio,
            commands::install_package,
            commands::set_system_ui_visibility,
            commands::get_status_bar_height,
            commands::get_sys_fonts_list,
            commands::intercept_keys,
            commands::lock_screen_orientation,
            commands::iap_is_available,
            commands::iap_initialize,
            commands::iap_fetch_products,
            commands::iap_purchase_product,
            commands::iap_restore_purchases,
            commands::get_system_color_scheme,
            commands::get_safe_area_insets,
            commands::get_screen_brightness,
            commands::set_screen_brightness,
            commands::get_external_sdcard_path,
            commands::open_external_url,
            commands::select_directory,
            commands::request_manage_storage_permission,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let native_bridge = mobile::init(app, api)?;
            #[cfg(desktop)]
            let native_bridge = desktop::init(app, api)?;
            app.manage(native_bridge);
            app.manage(DirectoryCallbackState::<R>::default());
            Ok(())
        })
        .build()
}

pub fn register_select_directory_callback<R: Runtime>(
    app: &AppHandle<R>,
    callback: impl Fn(&AppHandle<R>, &PathBuf) + Send + Sync + 'static,
) {
    if let Some(state) = app.try_state::<DirectoryCallbackState<R>>() {
        let mut cb = state.callback.lock().unwrap();
        *cb = Some(Box::new(callback));
    }
}
