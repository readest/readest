//! Receive-only LocalSend service: HTTPS server + discovery + the event pump
//! feeding the Lua-facing queue. Ported from the receive side of
//! apps/readest-app/src-tauri/src/localsend/service.rs.

use crate::config::StartConfig;
use crate::events::{self, Event, FileInfo, SenderInfo};
use crate::identity::Identity;
use localsend::discovery::{DiscoveryConfig, DiscoveryHandle, DEFAULT_DISCOVERY_TIMEOUT};
use localsend::http::server::common::save::FileUploadTarget;
use localsend::http::server::v2::{PrepareUploadDecisionV2, ServerEventV2, SessionEndReasonV2};
use localsend::http::server::web::{WebConfig, WebI18n};
use localsend::http::server::{start_with_port, ServerConfigV2, ServerHandle};
use localsend::model::transfer::FileDto;
use localsend::multicast::{
    InterfaceFilter, DEFAULT_MULTICAST_GROUP, DEFAULT_MULTICAST_GROUP_V6, DEFAULT_PORT,
};
use localsend::util::filename::{sanitize_with, Options, Rules};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use tokio::sync::{mpsc, oneshot};

/// 53317 is left to the LocalSend app; discovery still works because the
/// multicast socket shares UDP 53317 (SO_REUSEPORT) and every announce
/// carries the real HTTP port.
pub const FIRST_PORT: u16 = 53318;
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = FIRST_PORT..=53327;
pub const STAGING_DIR: &str = ".localsend-inbox";

pub struct PendingReceive {
    pub files: HashMap<String, FileDto>,
    pub decision_tx: oneshot::Sender<PrepareUploadDecisionV2>,
}

#[derive(Default)]
pub struct ReceiveSession {
    pub finished: usize,
    pub failed: usize,
    pub in_progress: HashSet<String>,
    /// Set when the server reported the session end; the summary event is
    /// deferred until every in-flight per-file result has been queued.
    pub ended: Option<SessionEndReasonV2>,
}

pub type PendingMap = Arc<Mutex<HashMap<String, PendingReceive>>>;
pub type ReceivingMap = Arc<Mutex<HashMap<String, ReceiveSession>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct Service {
    pub alias: String,
    pub port: u16,
    pub server: Arc<ServerHandle>,
    pub discovery: Arc<DiscoveryHandle>,
    pub server_stop: Option<oneshot::Sender<()>>,
    pub discovery_stop: Option<oneshot::Sender<()>>,
    pub pending: PendingMap,
    pub receiving: ReceivingMap,
    pub multicast_error: Option<String>,
    pub download_dir: PathBuf,
}

pub async fn start(config: StartConfig) -> Result<Service, String> {
    let data_dir = PathBuf::from(&config.data_dir);
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("dataDir: {e}"))?;
    let download_dir = PathBuf::from(&config.download_dir);
    std::fs::create_dir_all(&download_dir).map_err(|e| format!("downloadDir: {e}"))?;
    sweep_staging(&download_dir);

    let device_type = config.device_type();
    let identity = Arc::new(
        Identity::load_or_generate(
            &data_dir,
            config.alias.clone(),
            config.device_model.clone(),
            device_type,
        )
        .map_err(|e| format!("{e:#}"))?,
    );

    let (server_tx, server_rx) = mpsc::channel::<ServerEventV2>(16);
    let mut bound: Option<(ServerHandle, oneshot::Sender<()>, u16)> = None;
    let mut last_err = String::new();
    for port in PORT_RANGE {
        let (stop_tx, stop_rx) = oneshot::channel::<()>();
        match start_with_port(
            port,
            Some(identity.tls_config()),
            identity.client_info(),
            None,
            Some(ServerConfigV2 {
                pin: None,
                verify_checksums: true,
                event_tx: server_tx.clone(),
            }),
            // Cert-less senders (the stable LocalSend app) fall back to the
            // body fingerprint; without this WebConfig the server demands a
            // TLS client certificate and resets their handshake.
            Some(WebConfig {
                send: None,
                upload: true,
                i18n: WebI18n::default(),
            }),
            stop_rx,
        )
        .await
        {
            Ok(server) => {
                bound = Some((server, stop_tx, port));
                break;
            }
            Err(err) => last_err = format!("{err:#}"),
        }
    }
    let (server, server_stop, port) =
        bound.ok_or(format!("no free port in 53318-53327: {last_err}"))?;

    // Multicast failure is not fatal: Readest senders also probe 53317/53318
    // during their subnet scan, which reaches this server directly.
    let (discovery_stop, discovery_stop_rx) = oneshot::channel::<()>();
    let discovery = Arc::new(
        localsend::discovery::start(
            DiscoveryConfig {
                group: DEFAULT_MULTICAST_GROUP,
                group_v6: Some(DEFAULT_MULTICAST_GROUP_V6),
                port: DEFAULT_PORT,
                interface_filter: InterfaceFilter::default(),
                device: identity.multicast_device(port),
                identity: identity.device_identity(),
                timeout: DEFAULT_DISCOVERY_TIMEOUT,
                // Receive-only: this device keeps no peer list, so nobody
                // consumes discovery events.
                event_tx: None,
            },
            discovery_stop_rx,
        )
        .await,
    );
    let multicast_error = discovery.multicast_error().map(|e| format!("{e:#}"));
    {
        // Announce this device; peers answer with an HTTP register request
        // that the crate's server responds to on its own.
        let discovery = discovery.clone();
        tokio::spawn(async move { discovery.announce().await });
    }

    let service = Service {
        alias: config.alias.clone(),
        port,
        server: Arc::new(server),
        discovery,
        server_stop: Some(server_stop),
        discovery_stop: Some(discovery_stop),
        pending: Arc::new(Mutex::new(HashMap::new())),
        receiving: Arc::new(Mutex::new(HashMap::new())),
        multicast_error,
        download_dir,
    };
    spawn_event_pump(&service, server_rx);
    events::push(&Event::Started {
        alias: config.alias,
        port,
    });
    Ok(service)
}

pub async fn stop(service: &mut Service) {
    if let Some(tx) = service.server_stop.take() {
        let _ = tx.send(());
    }
    if let Some(tx) = service.discovery_stop.take() {
        let _ = tx.send(());
    }
    let timeout = std::time::Duration::from_secs(1);
    let _ = tokio::time::timeout(timeout, service.server.wait_stopped()).await;
    let _ = tokio::time::timeout(timeout, service.discovery.wait_stopped()).await;
}

pub fn accept(service: &Service, session_id: &str) -> bool {
    let Some(pending) = lock(&service.pending).remove(session_id) else {
        return false;
    };
    let ids: HashSet<String> = pending.files.keys().cloned().collect();
    if pending
        .decision_tx
        .send(PrepareUploadDecisionV2::Accept(ids))
        .is_err()
    {
        // The request already ended on the wire.
        return false;
    }
    lock(&service.receiving).insert(session_id.to_string(), ReceiveSession::default());
    true
}

pub fn decline(service: &Service, session_id: &str) -> bool {
    let Some(pending) = lock(&service.pending).remove(session_id) else {
        return false;
    };
    let _ = pending.decision_tx.send(PrepareUploadDecisionV2::Decline);
    true
}

/// Non-loopback IPv4 addresses, VPN tunnels filtered so the "#octet" tag
/// shown to the user is a LAN address (same filter as the Tauri app).
pub fn local_ips() -> Vec<String> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    ifaces
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter(|i| {
            let n = i.name.as_str();
            !(n.starts_with("tun")
                || n.starts_with("utun")
                || n.starts_with("ppp")
                || n.starts_with("wg"))
        })
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(a) => Some(a.ip.to_string()),
            _ => None,
        })
        .collect()
}

fn spawn_event_pump(service: &Service, mut server_rx: mpsc::Receiver<ServerEventV2>) {
    let pending = service.pending.clone();
    let receiving = service.receiving.clone();
    let download_dir = service.download_dir.clone();
    tokio::spawn(async move {
        while let Some(event) = server_rx.recv().await {
            handle_server_event(&pending, &receiving, &download_dir, event);
        }
    });
}

fn handle_server_event(
    pending: &PendingMap,
    receiving: &ReceivingMap,
    download_dir: &Path,
    event: ServerEventV2,
) {
    match event {
        // Registers/announce answers are handled inside the crate's server
        // and discovery responder; a receive-only device keeps no peer list.
        ServerEventV2::Register { .. } => {}
        ServerEventV2::PrepareUpload {
            session_id,
            ip,
            info,
            cert_fingerprint: _,
            files,
            decision_tx,
        } => {
            let payload_files: Vec<FileInfo> = files
                .values()
                .map(|f| FileInfo {
                    id: f.id.clone(),
                    file_name: f.file_name.clone(),
                    size: f.size,
                })
                .collect();
            let total_size = payload_files.iter().map(|f| f.size).sum();
            let sender = SenderInfo {
                alias: info.alias.clone(),
                device_model: info.device_model.clone(),
                ip: ip.ip.to_string(),
            };
            lock(pending).insert(session_id.clone(), PendingReceive { files, decision_tx });
            events::push(&Event::ReceiveRequest {
                session_id,
                sender,
                files: payload_files,
                total_size,
            });
        }
        ServerEventV2::PrepareUploadAborted { session_id } => {
            if lock(pending).remove(&session_id).is_some() {
                events::push(&Event::ReceiveRequestClosed { session_id });
            }
        }
        ServerEventV2::FileUpload {
            session_id,
            file_id,
            file,
            target_tx,
        } => handle_file_upload(
            receiving,
            download_dir,
            session_id,
            file_id,
            file,
            target_tx,
        ),
        ServerEventV2::SessionEnd { session_id, reason } => {
            let mut sessions = lock(receiving);
            if let Some(session) = sessions.get_mut(&session_id) {
                session.ended = Some(reason);
                maybe_push_receive_end(&mut sessions, &session_id, download_dir);
            }
        }
        // Sending is not implemented on KOReader.
        ServerEventV2::CancelReceived { .. } => {}
    }
}

fn handle_file_upload(
    receiving: &ReceivingMap,
    download_dir: &Path,
    session_id: String,
    file_id: String,
    file: FileDto,
    target_tx: oneshot::Sender<FileUploadTarget>,
) {
    {
        let mut sessions = lock(receiving);
        let Some(session) = sessions.get_mut(&session_id) else {
            // Unknown session: dropping target_tx fails the request.
            return;
        };
        session.in_progress.insert(file_id.clone());
    }

    // The wire-supplied file name is peer-controlled and protocol v2 allows
    // directory components in it; sanitize before it ever touches a path so
    // a traversal payload (or an absolute path, which would make `join`
    // discard `staging`/`download_dir` entirely) cannot escape either dir.
    let file_name = safe_file_name(&file.file_name);

    let staging = download_dir.join(STAGING_DIR);
    let _ = std::fs::create_dir_all(&staging);
    let staging_path = unique_path(&staging, &file_name);

    let (result_tx, result_rx) = oneshot::channel::<Result<(), String>>();
    {
        let receiving = receiving.clone();
        let download_dir = download_dir.to_path_buf();
        let file_name = file_name.clone();
        let staging_path = staging_path.clone();
        tokio::spawn(async move {
            let result = match result_rx.await {
                Ok(result) => result,
                Err(_) => Err("upload aborted".to_string()),
            };
            let mut sessions = lock(&receiving);
            let Some(session) = sessions.get_mut(&session_id) else {
                let _ = std::fs::remove_file(&staging_path);
                return;
            };
            session.in_progress.remove(&file_id);
            let moved = result.and_then(|()| {
                let final_path = unique_path(&download_dir, &file_name);
                std::fs::rename(&staging_path, &final_path)
                    .map(|()| final_path)
                    .map_err(|e| e.to_string())
            });
            let (path, error) = match moved {
                Ok(final_path) => {
                    session.finished += 1;
                    (Some(final_path.to_string_lossy().into_owned()), None)
                }
                Err(err) => {
                    session.failed += 1;
                    let _ = std::fs::remove_file(&staging_path);
                    (None, Some(err))
                }
            };
            events::push(&Event::ReceiveFileDone {
                session_id: session_id.clone(),
                file_name,
                path,
                error,
            });
            maybe_push_receive_end(&mut sessions, &session_id, &download_dir);
        });
    }

    let _ = target_tx.send(FileUploadTarget::Path {
        path: staging_path,
        result_tx,
        progress_tx: None,
    });
}

fn maybe_push_receive_end(
    sessions: &mut HashMap<String, ReceiveSession>,
    session_id: &str,
    download_dir: &Path,
) {
    let done = sessions
        .get(session_id)
        .is_some_and(|s| s.ended.is_some() && s.in_progress.is_empty());
    if !done {
        return;
    }
    let session = sessions.remove(session_id).unwrap();
    let reason = match session.ended.unwrap() {
        SessionEndReasonV2::Finished => "finished",
        SessionEndReasonV2::Cancelled => "cancelled",
    };
    // Empty-only removal: a concurrent session may still be staging files.
    let _ = std::fs::remove_dir(download_dir.join(STAGING_DIR));
    events::push(&Event::ReceiveEnd {
        session_id: session_id.to_string(),
        reason: reason.to_string(),
        received: session.finished,
        failed: session.failed,
    });
}

fn sweep_staging(download_dir: &Path) {
    let _ = std::fs::remove_dir_all(download_dir.join(STAGING_DIR));
}

/// Sanitizes a peer-supplied file name before it is ever joined onto a path.
/// Mirrors `localsend::util::filename::sanitize_path` (take the last path
/// segment, drop `.`/`..`/empty segments, sanitize under the strictest
/// `Rules::Universal` set) but with an empty placeholder so a name that
/// collapses to nothing (`".."`, all separators, empty) is detectable here
/// and mapped to a fixed fallback name instead of the crate's own
/// "untitled" placeholder.
fn safe_file_name(name: &str) -> String {
    let last = name
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .unwrap_or("");
    let sanitized = sanitize_with(
        last,
        Rules::Universal,
        &Options {
            replacement: "_",
            placeholder: "",
        },
    );
    if sanitized.is_empty() {
        "received.bin".to_string()
    } else {
        sanitized
    }
}

/// "name.epub" -> "name (2).epub" until unused, like the upstream CLI.
pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (file_name.to_string(), String::new()),
    };
    for n in 2u32.. {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_path_appends_counter() {
        let dir = std::env::temp_dir().join(format!("lsffi-up-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "b.epub");
        assert_eq!(first, dir.join("b.epub"));
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(unique_path(&dir, "b.epub"), dir.join("b (2).epub"));
        std::fs::write(dir.join("b (2).epub"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "b.epub"), dir.join("b (3).epub"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn safe_file_name_flattens_traversal_to_last_segment() {
        assert_eq!(safe_file_name("../../../../etc/init.d/rcS"), "rcS");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
    }

    #[test]
    fn safe_file_name_drops_absolute_root() {
        assert_eq!(safe_file_name("/etc/passwd"), "passwd");
    }

    #[test]
    fn safe_file_name_falls_back_when_nothing_safe_survives() {
        assert_eq!(safe_file_name(""), "received.bin");
        assert_eq!(safe_file_name(".."), "received.bin");
        assert_eq!(safe_file_name("///"), "received.bin");
    }

    #[test]
    fn sweep_staging_removes_only_the_inbox() {
        let dir = std::env::temp_dir().join(format!("lsffi-sw-{}", std::process::id()));
        let staging = dir.join(STAGING_DIR);
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("partial.epub"), b"x").unwrap();
        std::fs::write(dir.join("keep.epub"), b"x").unwrap();
        sweep_staging(&dir);
        assert!(!staging.exists());
        assert!(dir.join("keep.epub").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
