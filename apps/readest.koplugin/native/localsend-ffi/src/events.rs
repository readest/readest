//! JSON events queued for the Lua side, drained via ls_poll_event. A global
//! FIFO (not per-service) so error events survive a failed start.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Event {
    Started { alias: String, port: u16 },
    ReceiveRequest { session_id: String, sender: SenderInfo, files: Vec<FileInfo>, total_size: u64 },
    ReceiveRequestClosed { session_id: String },
    ReceiveFileDone { session_id: String, file_name: String, path: Option<String>, error: Option<String> },
    ReceiveEnd { session_id: String, reason: String, received: usize, failed: usize },
    Error { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderInfo {
    pub alias: String,
    pub device_model: Option<String>,
    pub ip: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: String,
    pub file_name: String,
    pub size: u64,
}

static EVENTS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

fn queue() -> std::sync::MutexGuard<'static, VecDeque<String>> {
    EVENTS.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn push(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        queue().push_back(json);
    }
}

pub fn pop() -> Option<String> {
    queue().pop_front()
}

pub fn clear() {
    queue().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receive_request_serializes_snake_type_camel_fields() {
        clear();
        push(&Event::ReceiveRequest {
            session_id: "s1".into(),
            sender: SenderInfo {
                alias: "Mac".into(),
                device_model: Some("macOS".into()),
                ip: "192.168.1.120".into(),
            },
            files: vec![FileInfo { id: "f1".into(), file_name: "a.epub".into(), size: 7 }],
            total_size: 7,
        });
        let json = pop().unwrap();
        assert!(json.contains(r#""type":"receive_request""#), "{json}");
        assert!(json.contains(r#""sessionId":"s1""#), "{json}");
        assert!(json.contains(r#""fileName":"a.epub""#), "{json}");
        assert!(json.contains(r#""totalSize":7"#), "{json}");
        assert!(pop().is_none());
    }

    #[test]
    fn queue_is_fifo() {
        clear();
        push(&Event::Started { alias: "a".into(), port: 53318 });
        push(&Event::Error { message: "boom".into() });
        assert!(pop().unwrap().contains("started"));
        assert!(pop().unwrap().contains("boom"));
    }
}
