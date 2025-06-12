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
