//! Payloads of the `localsend:*` events emitted to the webview. Field names
//! serialize as camelCase to match the TypeScript types in
//! `src/services/localsend/types.ts`.

use serde::{Deserialize, Serialize};

pub const EV_SERVER_STATE: &str = "localsend:server-state";
pub const EV_DEVICES: &str = "localsend:devices";
pub const EV_RECEIVE_REQUEST: &str = "localsend:receive-request";
pub const EV_RECEIVE_REQUEST_CLOSED: &str = "localsend:receive-request-closed";
pub const EV_RECEIVE_PROGRESS: &str = "localsend:receive-progress";
pub const EV_RECEIVE_FILE_DONE: &str = "localsend:receive-file-done";
pub const EV_RECEIVE_END: &str = "localsend:receive-end";
pub const EV_SEND_PROGRESS: &str = "localsend:send-progress";
pub const EV_SEND_END: &str = "localsend:send-end";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendStatus {
    pub running: bool,
    pub alias: String,
    pub port: u16,
    pub fingerprint: String,
    pub multicast_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatePayload {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePayload {
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: Option<String>,
    pub fingerprint: String,
    pub host: String,
    pub port: u16,
    pub protocol: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesPayload {
    pub devices: Vec<DevicePayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub file_type: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderPayload {
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: Option<String>,
    pub fingerprint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveRequestPayload {
    pub session_id: String,
    pub sender: SenderPayload,
    pub files: Vec<FilePayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRefPayload {
    pub session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressPayload {
    pub session_id: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: usize,
    pub files_total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveFileDonePayload {
    pub session_id: String,
    pub file_id: String,
    pub file_name: String,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveEndPayload {
    pub session_id: String,
    /// "finished" | "cancelled"
    pub reason: String,
    pub received: usize,
    pub failed: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEndPayload {
    pub session_id: Option<String>,
    /// "sent" | "declined" | "cancelled" | "error"
    pub status: String,
    pub error: Option<String>,
    pub files_sent: usize,
}

/// A file offered for sending, as passed from the webview.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFileInput {
    pub path: String,
    pub file_name: String,
    pub mime_type: String,
}

pub fn device_type_str(t: &Option<localsend::model::discovery::DeviceType>) -> Option<String> {
    use localsend::model::discovery::DeviceType::*;
    t.as_ref().map(|t| {
        match t {
            Mobile => "mobile",
            Desktop => "desktop",
            Web => "web",
            Headless => "headless",
            Server => "server",
        }
        .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_serialize_camel_case() {
        let json = serde_json::to_value(ServerStatePayload {
            running: true,
            port: 53317,
            error: None,
        })
        .unwrap();
        assert_eq!(json["running"], true);
        assert_eq!(json["port"], 53317);

        let json = serde_json::to_value(DevicePayload {
            alias: "A".into(),
            device_model: Some("Readest".into()),
            device_type: Some("desktop".into()),
            fingerprint: "F".into(),
            host: "192.168.1.2".into(),
            port: 53317,
            protocol: "https".into(),
        })
        .unwrap();
        assert_eq!(json["deviceModel"], "Readest");
        assert_eq!(json["deviceType"], "desktop");

        let json = serde_json::to_value(ReceiveFileDonePayload {
            session_id: "s".into(),
            file_id: "f".into(),
            file_name: "a.epub".into(),
            path: Some("/tmp/a.epub".into()),
            error: None,
        })
        .unwrap();
        assert_eq!(json["sessionId"], "s");
        assert_eq!(json["fileName"], "a.epub");
    }

    #[test]
    fn send_file_input_deserializes_camel_case() {
        let input: SendFileInput = serde_json::from_str(
            r#"{"path":"/tmp/a.epub","fileName":"a.epub","mimeType":"application/epub+zip"}"#,
        )
        .unwrap();
        assert_eq!(input.file_name, "a.epub");
        assert_eq!(input.mime_type, "application/epub+zip");
    }
}
