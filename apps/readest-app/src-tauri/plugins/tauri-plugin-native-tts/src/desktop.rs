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
    let listeners = Listeners::default();
    #[cfg(target_os = "linux")]
    let player = crate::linux::Player::new(listeners.clone());
    Ok(NativeTts(
        app.clone(),
        listeners,
        #[cfg(target_os = "linux")]
        player,
        #[cfg(target_os = "linux")]
        crate::speech_dispatcher::SpeechSessions::default(),
    ))
}

/// Access to the native-tts APIs.
pub struct NativeTts<R: Runtime>(
    AppHandle<R>,
    Listeners,
    #[cfg(target_os = "linux")] crate::linux::Player,
    #[cfg(target_os = "linux")] crate::speech_dispatcher::SpeechSessions,
);

#[cfg(target_os = "linux")]
impl<R: Runtime> NativeTts<R> {
    pub(crate) fn remove_speech_session(&self, window: &str) {
        self.3.remove(window);
    }
    pub fn init(&self, window: &str) -> crate::Result<InitResponse> {
        let listeners = self.1.clone();
        let result = self.3.get(window).init(std::sync::Arc::new(move |event| {
            now_playing::emit(
                &listeners,
                "tts_events",
                serde_json::json!({
                    "utteranceId": event.utterance_id,
                    "code": event.code,
                    "message": event.message,
                }),
            );
        }));
        if let Err(error) = &result {
            eprintln!("System TTS unavailable: {error}");
        }
        Ok(InitResponse {
            success: result.is_ok(),
        })
    }
    pub fn speak(&self, window: &str, args: SpeakArgs) -> crate::Result<SpeakResponse> {
        self.3
            .get(window)
            .speak(&args.text)
            .map(|utterance_id| SpeakResponse { utterance_id })
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn pause(&self, window: &str) -> crate::Result<()> {
        self.3
            .get(window)
            .pause()
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn resume(&self, _window: &str) -> crate::Result<()> {
        Ok(())
    }
    pub fn stop(&self, window: &str, args: StopArgs) -> crate::Result<()> {
        self.3
            .get(window)
            .stop(args.utterance_id.as_deref())
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn set_rate(&self, window: &str, args: SetRateArgs) -> crate::Result<()> {
        let rate = crate::speech_dispatcher::ssip_rate(args.rate);
        self.3
            .get(window)
            .command(&format!("SET SELF RATE {rate}"))
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn set_pitch(&self, window: &str, args: SetPitchArgs) -> crate::Result<()> {
        let pitch = ((args.pitch - 1.) * 100.).round().clamp(-100., 100.) as i32;
        self.3
            .get(window)
            .command(&format!("SET SELF PITCH {pitch}"))
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn set_voice(&self, window: &str, args: SetVoiceArgs) -> crate::Result<()> {
        self.3
            .get(window)
            .set_voice(&args.voice)
            .map_err(crate::Error::NativeTTSError)
    }
    pub fn get_all_voices(&self, window: &str) -> crate::Result<GetVoicesResponse> {
        self.3
            .get(window)
            .voices()
            .map(|voices| GetVoicesResponse {
                voices: voices
                    .into_iter()
                    .map(|(id, name, lang)| TTSVoice {
                        id,
                        name,
                        lang,
                        disabled: false,
                    })
                    .collect(),
            })
            .map_err(crate::Error::NativeTTSError)
    }
}

#[cfg(not(target_os = "linux"))]
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
}

impl<R: Runtime> NativeTts<R> {
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
    #[cfg(target_os = "linux")]
    pub(crate) fn playout_control_enqueue(
        &self,
        payload: PlayoutControlRequest,
    ) -> crate::Result<crate::linux::PendingReply> {
        self.2.enqueue(&self.0, payload)
    }
    #[cfg(not(target_os = "linux"))]
    pub fn playout_control(
        &self,
        _payload: PlayoutControlRequest,
    ) -> crate::Result<PlayoutControlResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn playout_position(&self) -> crate::Result<PlayoutPositionResponse> {
        #[cfg(target_os = "linux")]
        {
            Ok(self.2.position())
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err(crate::Error::UnsupportedPlatformError)
        }
    }
}
