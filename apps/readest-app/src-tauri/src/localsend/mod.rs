pub mod commands;
pub mod events;
pub mod identity;
pub mod service;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri managed state: the running LocalSend service, or `None` while the
/// integration is disabled. The async mutex serializes start/stop/command
/// access without blocking the runtime.
#[derive(Default)]
pub struct LocalSendState(pub Arc<Mutex<Option<service::RunningService>>>);
