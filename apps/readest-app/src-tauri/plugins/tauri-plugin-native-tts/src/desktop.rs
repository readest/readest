use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::now_playing::{self, Listeners};
use serde_json::Value;
use tauri::ipc::Channel;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<NativeTts<R>> {
    Ok(NativeTts(app.clone(), Listeners::default()))
}

/// Access to the native-tts APIs.
pub struct NativeTts<R: Runtime>(AppHandle<R>, Listeners);

impl<R: Runtime> NativeTts<R> {
    pub fn init(&self) -> crate::Result<InitResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn speak(&self, _args: SpeakArgs) -> crate::Result<SpeakResponse> {
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
    pub fn set_rate(&self, _args: SetRateArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_pitch(&self, _args: SetPitchArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_voice(&self, _args: SetVoiceArgs) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_all_voices(&self) -> crate::Result<GetVoicesResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn set_media_session_active(
        &self,
        payload: SetMediaSessionActiveRequest,
    ) -> crate::Result<()> {
        now_playing::set_active(&self.0, &self.1, payload);
        Ok(())
    }
    pub fn update_media_session_state(
        &self,
        payload: UpdateMediaSessionStateRequest,
    ) -> crate::Result<()> {
        now_playing::update_state(&self.0, payload);
        Ok(())
    }
    pub fn update_media_session_metadata(
        &self,
        payload: UpdateMediaSessionMetadataRequest,
    ) -> crate::Result<()> {
        now_playing::update_metadata(&self.0, payload);
        Ok(())
    }
    pub fn register_listener(&self, event: String, handler: Channel<Value>) {
        now_playing::register_listener(&self.1, event, handler);
    }
    pub fn remove_listener(&self, event: &str, channel_id: u32) {
        now_playing::remove_listener(&self.1, event, channel_id);
    }
    pub fn update_media_library(&self, _payload: UpdateMediaLibraryRequest) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn update_carplay_state(&self, _payload: UpdateCarPlayStateRequest) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn playout_enqueue(
        &self,
        _payload: PlayoutEnqueueRequest,
    ) -> crate::Result<PlayoutEnqueueResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn playout_control(
        &self,
        _payload: PlayoutControlRequest,
    ) -> crate::Result<PlayoutControlResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn playout_position(&self) -> crate::Result<PlayoutPositionResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}
