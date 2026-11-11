use tauri::{command, AppHandle, Manager, Runtime};

use crate::models::*;
use crate::NativeTtsExt;
use crate::Result;

// Linux speech is scoped to the invoking window and uses blocking socket I/O.
// Mobile and the other desktops keep their existing plugin calls.
macro_rules! speech_command {
    ($webview:ident, $method:ident $(, $payload:ident)?) => {{
        let app = $webview.app_handle().clone();
        #[cfg(target_os = "linux")]
        {
            tauri::async_runtime::spawn_blocking(move || {
                app.native_tts().$method($webview.label() $(, $payload)?)
            })
            .await
            .map_err(|error| crate::Error::NativeTTSError(error.to_string()))?
        }
        #[cfg(not(target_os = "linux"))]
        {
            app.native_tts().$method($($payload)?)
        }
    }};
}

#[command]
pub(crate) async fn init<R: Runtime>(webview: tauri::Webview<R>) -> Result<InitResponse> {
    speech_command!(webview, init)
}

#[command]
pub(crate) async fn speak<R: Runtime>(
    webview: tauri::Webview<R>,
    payload: SpeakArgs,
) -> Result<SpeakResponse> {
    speech_command!(webview, speak, payload)
}

#[command]
pub(crate) async fn pause<R: Runtime>(webview: tauri::Webview<R>) -> Result<()> {
    speech_command!(webview, pause)
}

#[command]
pub(crate) async fn resume<R: Runtime>(webview: tauri::Webview<R>) -> Result<()> {
    speech_command!(webview, resume)
}

#[command]
pub(crate) async fn stop<R: Runtime>(
    webview: tauri::Webview<R>,
    payload: Option<StopArgs>,
) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let payload = payload.unwrap_or_default();
        speech_command!(webview, stop, payload)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = payload;
        speech_command!(webview, stop)
    }
}

#[command]
pub(crate) async fn set_rate<R: Runtime>(
    webview: tauri::Webview<R>,
    payload: SetRateArgs,
) -> Result<()> {
    speech_command!(webview, set_rate, payload)
}

#[command]
pub(crate) async fn set_pitch<R: Runtime>(
    webview: tauri::Webview<R>,
    payload: SetPitchArgs,
) -> Result<()> {
    speech_command!(webview, set_pitch, payload)
}

#[command]
pub(crate) async fn set_voice<R: Runtime>(
    webview: tauri::Webview<R>,
    payload: SetVoiceArgs,
) -> Result<()> {
    speech_command!(webview, set_voice, payload)
}

#[command]
pub(crate) async fn get_all_voices<R: Runtime>(
    webview: tauri::Webview<R>,
) -> Result<GetVoicesResponse> {
    speech_command!(webview, get_all_voices)
}

#[command]
pub(crate) async fn set_media_session_active<R: Runtime>(
    app: AppHandle<R>,
    payload: SetMediaSessionActiveRequest,
) -> Result<()> {
    app.native_tts().set_media_session_active(payload)
}

#[command]
pub(crate) async fn update_media_session_state<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateMediaSessionStateRequest,
) -> Result<()> {
    app.native_tts().update_media_session_state(payload)
}

#[command]
pub(crate) async fn update_media_session_metadata<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateMediaSessionMetadataRequest,
) -> Result<()> {
    app.native_tts().update_media_session_metadata(payload)
}

#[command]
pub(crate) async fn update_media_library<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateMediaLibraryRequest,
) -> Result<()> {
    app.native_tts().update_media_library(payload)
}

#[command]
pub(crate) async fn update_carplay_state<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateCarPlayStateRequest,
) -> Result<()> {
    app.native_tts().update_carplay_state(payload)
}

#[command]
pub(crate) async fn playout_enqueue<R: Runtime>(
    app: AppHandle<R>,
    payload: PlayoutEnqueueRequest,
) -> Result<PlayoutEnqueueResponse> {
    app.native_tts().playout_enqueue(payload)
}

// Called directly by the Linux IPC handler: async command macros defer even
// the first line to independently scheduled tasks, which can reorder controls.
#[cfg(target_os = "linux")]
pub(crate) fn playout_control<R: Runtime>(invoke: tauri::ipc::Invoke<R>) {
    use tauri::ipc::{CommandArg, CommandItem};
    use tauri::Manager;

    let payload = PlayoutControlRequest::from_command(CommandItem {
        plugin: Some("native-tts"),
        name: "playout_control",
        key: "payload",
        message: &invoke.message,
        acl: &invoke.acl,
    });
    let reply = payload.and_then(|payload| {
        invoke
            .message
            .webview()
            .app_handle()
            .native_tts()
            .playout_control_enqueue(payload)
            .map_err(Into::into)
    });
    match reply {
        Ok(reply) => invoke.resolver.respond_async(async move {
            tauri::async_runtime::spawn_blocking(move || {
                reply
                    .recv()
                    .map_err(|error| crate::Error::NativeTTSError(error.to_string()))?
                    .map_err(crate::Error::NativeTTSError)
            })
            .await
            .map_err(|error| crate::Error::NativeTTSError(error.to_string()))?
            .map_err(Into::into)
        }),
        Err(error) => invoke.resolver.invoke_error(error),
    }
}

#[cfg(not(target_os = "linux"))]
#[command]
pub(crate) async fn playout_control<R: Runtime>(
    app: AppHandle<R>,
    payload: PlayoutControlRequest,
) -> Result<PlayoutControlResponse> {
    app.native_tts().playout_control(payload)
}

#[command]
pub(crate) async fn playout_position<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PlayoutPositionResponse> {
    app.native_tts().playout_position()
}

// Desktop only: on mobile the native plugin owns listener registration, and a
// Rust handler for these would shadow it.
#[cfg(desktop)]
#[command]
pub(crate) async fn register_listener<R: Runtime>(
    app: AppHandle<R>,
    event: String,
    handler: tauri::ipc::Channel<serde_json::Value>,
) -> Result<()> {
    app.native_tts().register_listener(event, handler);
    Ok(())
}

#[cfg(desktop)]
#[command]
pub(crate) async fn remove_listener<R: Runtime>(
    app: AppHandle<R>,
    event: String,
    channel_id: u32,
) -> Result<()> {
    app.native_tts().remove_listener(&event, channel_id);
    Ok(())
}
