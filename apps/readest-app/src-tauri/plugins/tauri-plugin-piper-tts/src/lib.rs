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
use desktop::PiperTts;
#[cfg(mobile)]
use mobile::PiperTts;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the piper-tts APIs. Android-only: on-device Piper synthesis via
/// sherpa-onnx. Desktop/iOS builds compile against the same interface but
/// every call returns `UnsupportedPlatformError` (see desktop.rs) so callers
/// on the JS side can feature-detect via `init()`/`getAllVoices()` failing
/// rather than branching on platform.
pub trait PiperTtsExt<R: Runtime> {
    fn piper_tts(&self) -> &PiperTts<R>;
}

impl<R: Runtime, T: Manager<R>> crate::PiperTtsExt<R> for T {
    fn piper_tts(&self) -> &PiperTts<R> {
        self.state::<PiperTts<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("piper-tts")
        .invoke_handler(tauri::generate_handler![
            commands::list_voices,
            commands::download_voice,
            commands::cancel_download,
            commands::delete_voice,
            commands::load_voice,
            commands::unload_voice,
            commands::synthesize,
            commands::stop,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let piper_tts = mobile::init(app, api)?;
            #[cfg(desktop)]
            let piper_tts = desktop::init(app, api)?;
            app.manage(piper_tts);
            Ok(())
        })
        .build()
}
