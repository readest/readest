use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

// initializes the Kotlin plugin class (Android only — there is no iOS
// counterpart for now, unlike tauri-plugin-native-tts).
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<PiperTts<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.readest.piper_tts", "PiperTTSPlugin")?;
    #[cfg(not(target_os = "android"))]
    let handle = {
        let _ = api;
        return Err(crate::Error::UnsupportedPlatformError);
    };
    Ok(PiperTts(handle))
}

/// Access to the piper-tts APIs.
pub struct PiperTts<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PiperTts<R> {
    pub fn list_voices(&self, payload: ListVoicesArgs) -> crate::Result<ListVoicesResponse> {
        self.0
            .run_mobile_plugin("list_voices", payload)
            .map_err(Into::into)
    }

    pub fn download_voice(
        &self,
        payload: DownloadVoiceArgs,
    ) -> crate::Result<DownloadVoiceResponse> {
        self.0
            .run_mobile_plugin("download_voice", payload)
            .map_err(Into::into)
    }

    pub fn cancel_download(&self, payload: CancelDownloadArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("cancel_download", payload)
            .map_err(Into::into)
    }

    pub fn delete_voice(&self, payload: DeleteVoiceArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("delete_voice", payload)
            .map_err(Into::into)
    }

    pub fn load_voice(&self, payload: LoadVoiceArgs) -> crate::Result<LoadVoiceResponse> {
        self.0
            .run_mobile_plugin("load_voice", payload)
            .map_err(Into::into)
    }

    pub fn unload_voice(&self, payload: LoadVoiceArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("unload_voice", payload)
            .map_err(Into::into)
    }

    pub fn synthesize(&self, payload: SynthesizeArgs) -> crate::Result<SynthesizeResponse> {
        self.0
            .run_mobile_plugin("synthesize", payload)
            .map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }
}
