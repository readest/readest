use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;
#[cfg(desktop)]
mod now_playing;

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
    // register_listener/remove_listener are Rust commands only on desktop; on
    // mobile they must fall through to the native plugin.
    macro_rules! handler {
        ($($extra:path),*) => {
            tauri::generate_handler![
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
            commands::update_media_library,
            commands::update_carplay_state,
            commands::playout_enqueue,
            commands::playout_control,
            commands::playout_position $(, $extra)*]
        };
    }
    let builder = Builder::new("native-tts");
    #[cfg(desktop)]
    let builder = builder.invoke_handler(handler!(
        commands::register_listener,
        commands::remove_listener
    ));
    #[cfg(mobile)]
    let builder = builder.invoke_handler(handler!());
    builder
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
