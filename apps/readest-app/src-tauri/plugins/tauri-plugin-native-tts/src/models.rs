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

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopArgs {
    pub utterance_id: Option<String>,
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
    pub session_id: Option<String>,
    // Android: whether the media service should hold the app's audio focus for
    // this session. False when the session's audio plays through a WebView
    // media element, which Chromium already requests focus for (see
    // MediaPlaybackService.ownsAudioFocus). Defaults to true when absent.
    pub owns_audio_focus: Option<bool>,
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
    pub session_id: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaSessionMetadataRequest {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaLibraryRequest {
    pub books_json: String,
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
    // Absolute file path for action "load" (Media Overlay continuous playout).
    pub path: Option<String>,
    // Seek target for actions "load" and "seek", in milliseconds.
    pub position_ms: Option<f64>,
    // Byte window [start, end) of `path` to play as the whole track: a stored
    // audio entry inside the book's zip. iOS also needs its MIME type, since
    // the file's own extension names the book.
    pub start: Option<u64>,
    pub end: Option<u64>,
    pub content_type: Option<String>,
    // Linux reads compressed narration directly from this ZIP entry.
    pub entry: Option<String>,
    // Android "set-loop": the A-B span to repeat, in ms of `path`.
    pub loop_start_ms: Option<f64>,
    pub loop_end_ms: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutControlResponse {
    pub session: Option<i32>,
    // Android "set-loop": whether the span was set on the file now playing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armed: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayoutPositionResponse {
    pub session: i32,
    pub index: i32,
    pub position_ms: f64,
    pub playing: bool,
    // Android: the item the playlist ended on, once nothing is current.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_index: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // The plugin's Kotlin and Swift sides read the payload re-serialized from
    // these structs, so a field missing here never reaches them.
    #[test]
    fn playout_control_keeps_the_a_b_loop_fields() {
        let request: PlayoutControlRequest = serde_json::from_value(serde_json::json!({
            "action": "set-loop",
            "path": "/cache/ch1.mp3",
            "loopStartMs": 65000.0,
            "loopEndMs": 80000.0,
        }))
        .unwrap();
        let forwarded = serde_json::to_value(&request).unwrap();
        assert_eq!(forwarded["loopStartMs"], 65000.0);
        assert_eq!(forwarded["loopEndMs"], 80000.0);

        let response: PlayoutControlResponse =
            serde_json::from_value(serde_json::json!({ "session": 3, "armed": true })).unwrap();
        assert_eq!(serde_json::to_value(&response).unwrap()["armed"], true);
    }
}
