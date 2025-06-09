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
    pub fn init(&self) -> crate::Result<bool> {
        self.0.run_mobile_plugin("init", ()).map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn speak(&self, args: SpeakArgs) -> crate::Result<String> {
        self.0.run_mobile_plugin("speak", args).map_err(Into::into)
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
    pub fn set_primary_lang(&self, args: SetLangArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_primary_lang", args)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_rate(&self, args: SetRateArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_rate", args)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_pitch(&self, args: SetPitchArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_pitch", args)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn set_voice(&self, args: SetVoiceArgs) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("set_voice", args)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_voices(&self, args: GetVoicesArgs) -> crate::Result<Vec<TTSVoice>> {
        self.0
            .run_mobile_plugin("get_voices", args)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_all_voices(&self) -> crate::Result<Vec<TTSVoice>> {
        self.0
            .run_mobile_plugin("get_all_voices", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_granularities(&self) -> crate::Result<Vec<TTSGranularity>> {
        self.0
            .run_mobile_plugin("get_granularities", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_voice_id(&self) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("get_voice_id", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeTts<R> {
    pub fn get_speaking_lang(&self) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("get_speaking_lang", ())
            .map_err(Into::into)
    }
}
