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
        .invoke_handler(tauri::generate_handler![commands::auth_with_safari])
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
