use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TTSVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TTSMessageEvent {
    pub code: String, // 'boundary' | 'error' | 'end'
    pub message: Option<String>,
    pub mark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TTSGranularity {
    #[serde(rename = "word")]
    Word,
    #[serde(rename = "sentence")]
    Sentence,
    #[serde(rename = "paragraph")]
    Paragraph,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpeakArgs {
    pub ssml: String,
    #[serde(default)]
    pub preload: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SetLangArgs {
    pub lang: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SetRateArgs {
    pub rate: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SetPitchArgs {
    pub pitch: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SetVoiceArgs {
    pub voice: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetVoicesArgs {
    pub lang: String,
}
