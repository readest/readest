use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_tts);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NativeTts<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.readest.native_tts", "NativeTTSPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_native_tts)?;
    Ok(NativeTts(handle))
}

/// Access to the native-tts APIs.
pub struct NativeTts<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeTts<R> {
    pub fn init(&self) -> crate::Result<InitResponse> {
        self.0.run_mobile_plugin("init", ()).map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn speak(&self, payload: SpeakArgs) -> crate::Result<SpeakResponse> {
        self.0
            .run_mobile_plugin("speak", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn pause(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("pause", ()).map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn resume(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("resume", ()).map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_rate(&self, payload: SetRateArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_rate", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_pitch(&self, payload: SetPitchArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_pitch", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_voice(&self, payload: SetVoiceArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_voice", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_all_voices(&self) -> crate::Result<GetVoicesResponse> {
        self.0
            .run_mobile_plugin("get_all_voices", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_media_session_active(
        &self,
        payload: SetMediaSessionActiveRequest,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_media_session_active", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn update_media_session_state(
        &self,
        payload: UpdateMediaSessionStateRequest,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("update_media_session_state", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn update_media_session_metadata(
        &self,
        payload: UpdateMediaSessionMetadataRequest,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("update_media_session_metadata", payload)
            .map_err(Into::into)
    }
}
