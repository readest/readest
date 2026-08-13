//! JSON events queued for the Lua side, drained via ls_poll_event. A global
//! FIFO (not per-service) so error events survive a failed start.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock, PoisonError};
use tokio::sync::Notify;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    Started {
        alias: String,
        port: u16,
    },
    ReceiveRequest {
        session_id: String,
        sender: SenderInfo,
        files: Vec<FileInfo>,
        total_size: u64,
    },
    ReceiveRequestClosed {
        session_id: String,
    },
    ReceiveFileDone {
        session_id: String,
        file_name: String,
        path: Option<String>,
        error: Option<String>,
    },
    ReceiveEnd {
        session_id: String,
        reason: String,
        received: usize,
        failed: usize,
    },
    Error {
        message: String,
    },
    Status {
        running: bool,
        alias: Option<String>,
        port: Option<u16>,
        local_ips: Vec<String>,
        multicast_error: Option<String>,
    },
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

/// Wakes anyone awaiting `notified()` as soon as a new event is queued, so
/// the helper binary's event forwarder can block on this instead of
/// busy-polling `pop()` in a loop.
static NOTIFY: OnceLock<Notify> = OnceLock::new();

fn notify() -> &'static Notify {
    NOTIFY.get_or_init(Notify::new)
}

/// Resolves once the next `push()` call happens after this future was
/// created. Callers that want to drain the queue first and only then wait
/// must call this *after* draining, otherwise a push that lands in between
/// is missed until the following one.
pub fn notified() -> tokio::sync::futures::Notified<'static> {
    notify().notified()
}

pub fn push(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        queue().push_back(json);
    }
    notify().notify_one();
}

pub fn pop() -> Option<String> {
    queue().pop_front()
}

pub fn clear() {
    queue().clear();
}

/// Serializes every test (in this module and elsewhere in the crate) that
/// touches the process-global `EVENTS` queue, so parallel test threads don't
/// interleave their clear/push/pop calls. Poison-safe: one failing test
/// under the guard must not cascade into every later test failing too.
#[cfg(test)]
pub(crate) static TEST_QUEUE_GUARD: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_queue_contract() {
        let _guard = TEST_QUEUE_GUARD
            .lock()
            .unwrap_or_else(PoisonError::into_inner);

        // Serialization: verify snake_case type tags, camelCase field names, and nested struct fields
        clear();
        push(&Event::ReceiveRequest {
            session_id: "s1".into(),
            sender: SenderInfo {
                alias: "Mac".into(),
                device_model: Some("macOS".into()),
                ip: "192.168.1.120".into(),
            },
            files: vec![FileInfo {
                id: "f1".into(),
                file_name: "a.epub".into(),
                size: 7,
            }],
            total_size: 7,
        });
        let json = pop().unwrap();

        // Type tag and top-level fields
        assert!(json.contains(r#""type":"receive_request""#), "{json}");
        assert!(json.contains(r#""sessionId":"s1""#), "{json}");
        assert!(json.contains(r#""totalSize":7"#), "{json}");

        // Nested sender struct fields
        assert!(json.contains(r#""alias":"Mac""#), "{json}");
        assert!(json.contains(r#""deviceModel":"macOS""#), "{json}");
        assert!(json.contains(r#""ip":"192.168.1.120""#), "{json}");

        // Nested files array and FileInfo struct fields
        assert!(json.contains(r#""fileName":"a.epub""#), "{json}");
        assert!(json.contains(r#""id":"f1""#), "{json}");
        assert!(json.contains(r#""size":7"#), "{json}");

        assert!(pop().is_none(), "queue should be empty after draining");

        // FIFO behavior: verify queue processes events in order
        push(&Event::Started {
            alias: "a".into(),
            port: 53318,
        });
        push(&Event::Error {
            message: "boom".into(),
        });

        let first = pop().unwrap();
        assert!(
            first.contains("started"),
            "first pop should be Started event: {first}"
        );

        let second = pop().unwrap();
        assert!(
            second.contains("boom"),
            "second pop should be Error event: {second}"
        );

        assert!(
            pop().is_none(),
            "queue should be empty after draining both events"
        );
    }
}
