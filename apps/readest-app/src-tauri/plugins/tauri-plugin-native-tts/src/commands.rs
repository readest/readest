use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeTtsExt;
use crate::Result;

#[command]
pub async fn init<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.native_tts().init()
}

#[command]
pub async fn speak<R: Runtime>(app: AppHandle<R>, args: SpeakArgs) -> Result<String> {
    app.native_tts().speak(args)
}

#[command]
pub async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().pause()
}

#[command]
pub async fn resume<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().resume()
}

#[command]
pub async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().stop()
}

#[command]
pub async fn set_primary_lang<R: Runtime>(app: AppHandle<R>, args: SetLangArgs) -> Result<()> {
    app.native_tts().set_primary_lang(args)
}

#[command]
pub async fn set_rate<R: Runtime>(app: AppHandle<R>, args: SetRateArgs) -> Result<()> {
    app.native_tts().set_rate(args)
}

#[command]
pub async fn set_pitch<R: Runtime>(app: AppHandle<R>, args: SetPitchArgs) -> Result<()> {
    app.native_tts().set_pitch(args)
}

#[command]
pub async fn set_voice<R: Runtime>(app: AppHandle<R>, args: SetVoiceArgs) -> Result<()> {
    app.native_tts().set_voice(args)
}

#[command]
pub async fn get_all_voices<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TTSVoice>> {
    app.native_tts().get_all_voices()
}

#[command]
pub async fn get_voices<R: Runtime>(
    app: AppHandle<R>,
    args: GetVoicesArgs,
) -> Result<Vec<TTSVoice>> {
    app.native_tts().get_voices(args)
}

#[command]
pub async fn get_granularities<R: Runtime>(app: AppHandle<R>) -> Result<Vec<TTSGranularity>> {
    app.native_tts().get_granularities()
}

#[command]
pub async fn get_voice_id<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    app.native_tts().get_voice_id()
}

#[command]
pub async fn get_speaking_lang<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    app.native_tts().get_speaking_lang()
}
