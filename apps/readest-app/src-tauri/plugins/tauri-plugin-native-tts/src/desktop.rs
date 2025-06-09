use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NativeTts<R>> {
    Ok(NativeTts(app.clone()))
}

/// Access to the native-tts APIs.
pub struct NativeTts<R: Runtime>(AppHandle<R>);

impl<R: Runtime> NativeTts<R> {
    pub fn init(&self) -> crate::Result<bool> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn speak(&self, _args: SpeakArgs) -> crate::Result<String> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn pause(&self) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn resume(&self) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn stop(&self) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_primary_lang(&self, _args: SetLangArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_rate(&self, _args: SetRateArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_pitch(&self, _args: SetPitchArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_voice(&self, _args: SetVoiceArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_all_voices(&self) -> crate::Result<Vec<TTSVoice>> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_voices(&self, _args: GetVoicesArgs) -> crate::Result<Vec<TTSVoice>> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_granularities(&self) -> crate::Result<Vec<TTSGranularity>> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_voice_id(&self) -> crate::Result<String> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_speaking_lang(&self) -> crate::Result<String> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}
