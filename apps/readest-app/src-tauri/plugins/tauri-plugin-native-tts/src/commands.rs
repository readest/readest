use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeTtsExt;
use crate::Result;

#[command]
pub(crate) async fn init<R: Runtime>(app: AppHandle<R>) -> Result<InitResponse> {
    app.native_tts().init()
}

#[command]
pub(crate) async fn speak<R: Runtime>(
    app: AppHandle<R>,
    payload: SpeakArgs,
) -> Result<SpeakResponse> {
    app.native_tts().speak(payload)
}

#[command]
pub(crate) async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().pause()
}

#[command]
pub(crate) async fn resume<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().resume()
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().stop()
}

#[command]
pub(crate) async fn set_rate<R: Runtime>(app: AppHandle<R>, payload: SetRateArgs) -> Result<()> {
    app.native_tts().set_rate(payload)
}

#[command]
pub(crate) async fn set_pitch<R: Runtime>(app: AppHandle<R>, payload: SetPitchArgs) -> Result<()> {
    app.native_tts().set_pitch(payload)
}

#[command]
pub(crate) async fn set_voice<R: Runtime>(app: AppHandle<R>, payload: SetVoiceArgs) -> Result<()> {
    app.native_tts().set_voice(payload)
}

#[command]
pub(crate) async fn get_all_voices<R: Runtime>(app: AppHandle<R>) -> Result<GetVoicesResponse> {
    app.native_tts().get_all_voices()
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
