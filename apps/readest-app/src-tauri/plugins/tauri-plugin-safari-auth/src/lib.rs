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

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::SafariAuth;
#[cfg(mobile)]
use mobile::SafariAuth;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the safari-auth APIs.
pub trait SafariAuthExt<R: Runtime> {
    fn safari_auth(&self) -> &SafariAuth<R>;
}

impl<R: Runtime, T: Manager<R>> crate::SafariAuthExt<R> for T {
    fn safari_auth(&self) -> &SafariAuth<R> {
        self.state::<SafariAuth<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("safari-auth")
        .invoke_handler(tauri::generate_handler![commands::auth_with_safari])
        .setup(|app, api| {
            #[cfg(mobile)]
            let safari_auth = mobile::init(app, api)?;
            #[cfg(desktop)]
            let safari_auth = desktop::init(app, api)?;
            app.manage(safari_auth);
            Ok(())
        })
        .build()
}
