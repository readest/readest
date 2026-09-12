use serde::{Deserialize, Serialize};

// A downloadable Piper voice. `archive_url` points at sherpa-onnx's own
// pre-converted release package for this voice — a .tar.bz2 containing
// model.onnx + tokens.txt (+ its own copy of espeak-ng-data, which we
// ignore and fetch once globally instead — see ensureEspeakData in the
// Kotlin plugin). This is NOT the raw .onnx/.onnx.json pair from
// rhasspy/piper-voices on Hugging Face: those lack the ONNX metadata
// sherpa-onnx's VITS loader requires (language/voice/comment), which only
// exists in sherpa-onnx's own converted packages — see
// android/README-SHERPA-ONNX.md. `id` is the stable key used for the
// on-disk directory and as the TTSVoice id on the JS side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceDescriptor {
    pub id: String,
    pub name: String,
    pub lang: String,
    pub quality: String,
    pub archive_url: String,
    #[serde(default)]
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceStatus {
    pub id: String,
    pub downloaded: bool,
    #[serde(default)]
    pub bytes_on_disk: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListVoicesArgs {
    pub catalog: Vec<VoiceDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListVoicesResponse {
    pub voices: Vec<VoiceStatus>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadVoiceArgs {
    pub voice: VoiceDescriptor,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadVoiceResponse {
    pub id: String,
    pub success: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelDownloadArgs {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteVoiceArgs {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoadVoiceArgs {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoadVoiceResponse {
    pub id: String,
    pub sample_rate: u32,
    pub num_speakers: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SynthesizeArgs {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub speaker_id: u32,
    // Piper's own prosody speed multiplier (1.0 = model default). The
    // playback rate itself is applied later by BufferedTTSClient/WSOLA, so
    // this should normally stay at 1.0 — see providers/types.ts.
    #[serde(default = "default_speed")]
    pub speed: f32,
}

fn default_speed() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize)]
pub struct SynthesizeResponse {
    // Base64-encoded 16-bit PCM WAV, mono, at the model's native sample rate.
    pub audio_base64: String,
    pub sample_rate: u32,
    pub num_samples: u32,
}

// Progress events streamed while a voice download is in flight, delivered
// through the plugin's "piper-tts" / "download_progress" channel (mirrors
// how native-tts streams "tts_events").
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub id: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub done: bool,
    pub error: Option<String>,
}
