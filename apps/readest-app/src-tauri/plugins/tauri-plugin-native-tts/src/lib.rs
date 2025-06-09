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
            commands::set_primary_lang,
            commands::get_voices,
            commands::get_voice_id,
            commands::get_all_voices,
            commands::get_granularities,
            commands::get_speaking_lang
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
