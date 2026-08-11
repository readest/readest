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
    /// OS name announced to peers ("macOS", "Android", ...).
    pub device_model: String,
    /// Non-loopback IPv4 addresses of this host; the UI derives the
    /// "#<last-octet>" device tag from them.
    pub local_ips: Vec<String>,
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
    /// An IPv4 address of the device when one is known; the UI derives the
    /// "#<last-octet>" tag from it (`host` may be IPv6).
    pub ipv4_host: Option<String>,
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
    /// Base64 thumbnail from the sender, passed through for the accept dialog.
    pub preview: Option<String>,
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
    /// Base64 thumbnail shown by the receiver (LocalSend `preview` field).
    #[serde(default)]
    pub preview: Option<String>,
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
            ipv4_host: Some("192.168.1.2".into()),
        })
        .unwrap();
        assert_eq!(json["deviceModel"], "Readest");
        assert_eq!(json["deviceType"], "desktop");
        assert_eq!(json["ipv4Host"], "192.168.1.2");

        let json = serde_json::to_value(FilePayload {
            id: "f".into(),
            file_name: "b.epub".into(),
            size: 1,
            file_type: "application/epub+zip".into(),
            preview: Some("aGk=".into()),
        })
        .unwrap();
        assert_eq!(json["fileName"], "b.epub");
        assert_eq!(json["preview"], "aGk=");

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
