use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSMessageEvent {
    pub code: String, // 'boundary' | 'error' | 'end'
    pub message: Option<String>,
    pub mark: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakArgs {
    pub text: String,
    #[serde(default)]
    pub preload: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakResponse {
    pub utterance_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRateArgs {
    pub rate: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPitchArgs {
    pub pitch: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVoiceArgs {
    pub voice: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetVoicesResponse {
    pub voices: Vec<TTSVoice>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMediaSessionActiveRequest {
    pub active: bool,
    pub notification_title: Option<String>,
    pub notification_text: Option<String>,
    pub foreground_service_title: Option<String>,
    pub foreground_service_text: Option<String>,
    // Identity of the book being read, persisted so the Android Auto browse
    // tree can offer a "Resume last book" entry after the process is cold.
    pub book_hash: Option<String>,
    pub book_title: Option<String>,
    pub book_author: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaSessionStateRequest {
    pub playing: bool,
    pub position: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaSessionMetadataRequest {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCarPlayStateRequest {
    pub active: bool,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutEnqueueRequest {
    pub session: i32,
    pub index: i32,
    pub data: String,
    pub gap_ms: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutEnqueueResponse {
    pub duration_ms: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutControlRequest {
    pub action: String,
    pub rate: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutControlResponse {
    pub session: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutPositionResponse {
    pub session: i32,
    pub index: i32,
    pub position_ms: f64,
    pub playing: bool,
}
