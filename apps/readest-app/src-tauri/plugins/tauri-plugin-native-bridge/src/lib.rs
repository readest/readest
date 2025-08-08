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
            commands::iap_initialize,
            commands::iap_fetch_products,
            commands::iap_purchase_product,
            commands::iap_restore_purchases,
            commands::get_system_color_scheme,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let native_bridge = mobile::init(app, api)?;
            #[cfg(desktop)]
            let native_bridge = desktop::init(app, api)?;
            app.manage(native_bridge);
            Ok(())
        })
        .build()
}
