use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::PiperTtsExt;

#[command]
pub(crate) async fn list_voices<R: Runtime>(
    app: AppHandle<R>,
    payload: ListVoicesArgs,
) -> crate::Result<ListVoicesResponse> {
    app.piper_tts().list_voices(payload)
}

#[command]
pub(crate) async fn download_voice<R: Runtime>(
    app: AppHandle<R>,
    payload: DownloadVoiceArgs,
) -> crate::Result<DownloadVoiceResponse> {
    app.piper_tts().download_voice(payload)
}

#[command]
pub(crate) async fn cancel_download<R: Runtime>(
    app: AppHandle<R>,
    payload: CancelDownloadArgs,
) -> crate::Result<()> {
    app.piper_tts().cancel_download(payload)
}

#[command]
pub(crate) async fn delete_voice<R: Runtime>(
    app: AppHandle<R>,
    payload: DeleteVoiceArgs,
) -> crate::Result<()> {
    app.piper_tts().delete_voice(payload)
}

#[command]
pub(crate) async fn load_voice<R: Runtime>(
    app: AppHandle<R>,
    payload: LoadVoiceArgs,
) -> crate::Result<LoadVoiceResponse> {
    app.piper_tts().load_voice(payload)
}

#[command]
pub(crate) async fn unload_voice<R: Runtime>(
    app: AppHandle<R>,
    payload: LoadVoiceArgs,
) -> crate::Result<()> {
    app.piper_tts().unload_voice(payload)
}

#[command]
pub(crate) async fn synthesize<R: Runtime>(
    app: AppHandle<R>,
    payload: SynthesizeArgs,
) -> crate::Result<SynthesizeResponse> {
    app.piper_tts().synthesize(payload)
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
    app.piper_tts().stop()
}
