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
use desktop::NativeTts;
#[cfg(mobile)]
use mobile::NativeTts;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the native-tts APIs.
pub trait NativeTtsExt<R: Runtime> {
    fn native_tts(&self) -> &NativeTts<R>;
}

impl<R: Runtime, T: Manager<R>> crate::NativeTtsExt<R> for T {
    fn native_tts(&self) -> &NativeTts<R> {
        self.state::<NativeTts<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-tts")
        .invoke_handler(tauri::generate_handler![
            commands::init,
            commands::speak,
            commands::stop,
            commands::pause,
            commands::resume,
            commands::set_rate,
            commands::set_pitch,
            commands::set_voice,
            commands::get_all_voices,
            commands::set_media_session_active,
            commands::update_media_session_state,
            commands::update_media_session_metadata,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let native_tts = mobile::init(app, api)?;
            #[cfg(desktop)]
            let native_tts = desktop::init(app, api)?;
            app.manage(native_tts);
            Ok(())
        })
        .build()
}
