use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<PiperTts<R>> {
    Ok(PiperTts(app.clone()))
}

/// Desktop/iOS stand-in: embedded Piper is Android-only for now, so every
/// call fails uniformly and PiperTTSClient.init() on the JS side reports
/// itself unavailable instead of the engine appearing in the voice picker.
pub struct PiperTts<R: Runtime>(AppHandle<R>);

impl<R: Runtime> PiperTts<R> {
    pub fn list_voices(&self, _payload: ListVoicesArgs) -> crate::Result<ListVoicesResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn download_voice(
        &self,
        _payload: DownloadVoiceArgs,
    ) -> crate::Result<DownloadVoiceResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn cancel_download(&self, _payload: CancelDownloadArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn delete_voice(&self, _payload: DeleteVoiceArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn load_voice(&self, _payload: LoadVoiceArgs) -> crate::Result<LoadVoiceResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn unload_voice(&self, _payload: LoadVoiceArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn synthesize(&self, _payload: SynthesizeArgs) -> crate::Result<SynthesizeResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn stop(&self) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}
