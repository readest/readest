//! LocalSend service: HTTPS server + discovery + the event pump feeding the
//! Lua-facing queue. Ported from
//! apps/readest-app/src-tauri/src/localsend/service.rs (both the receive
//! side and, for `device_payloads`/`start_send`/`run_send`/`cancel_send`,
//! the send side).

use crate::config::StartConfig;
use crate::events::{self, DevicePayload, Event, FileInfo, SenderInfo};
use crate::identity::Identity;
use localsend::discovery::{
    DeviceChannel, DiscoveredDevice, DiscoveryConfig, DiscoveryHandle, HttpChannel,
    DEFAULT_DISCOVERY_TIMEOUT,
};
use localsend::http::dto_v2::RegisterDtoV2;
use localsend::http::server::common::save::FileUploadTarget;
use localsend::http::server::v2::{PrepareUploadDecisionV2, ServerEventV2, SessionEndReasonV2};
use localsend::http::server::web::{WebConfig, WebI18n};
use localsend::http::server::{start_with_port, ServerConfigV2, ServerHandle};
use localsend::model::discovery::ProtocolType;
use localsend::model::transfer::FileDto;
use localsend::multicast::{
    InterfaceFilter, DEFAULT_MULTICAST_GROUP, DEFAULT_MULTICAST_GROUP_V6, DEFAULT_PORT,
};
use localsend::util::filename::{sanitize_with, Options, Rules};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

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
pub type SendCancelSlot = Arc<Mutex<Option<SendCancel>>>;

/// A file offered for sending, resolved from a Lua-supplied path.
pub struct SendFileJob {
    pub dto: FileDto,
    pub path: PathBuf,
}

/// Cancellation state of the (single) active send session. Ported from
/// `SendCancel` in apps/readest-app/src-tauri/src/localsend/service.rs.
pub struct SendCancel {
    pub token: CancellationToken,
    /// Set (before triggering `token`) when the receiver requested the
    /// cancellation; only a local cancellation still notifies the receiver.
    pub by_peer: Arc<AtomicBool>,
    pub session_id: Option<String>,
    pub host: String,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct Service {
    pub alias: String,
    pub identity: Arc<Identity>,
    pub port: u16,
    pub server: Arc<ServerHandle>,
    pub discovery: Arc<DiscoveryHandle>,
    pub server_stop: Option<oneshot::Sender<()>>,
    pub discovery_stop: Option<oneshot::Sender<()>>,
    pub pending: PendingMap,
    pub receiving: ReceivingMap,
    pub send_cancel: SendCancelSlot,
    pub multicast_error: Option<String>,
    pub download_dir: PathBuf,
}

/// Does not push `Event::Started` itself: the caller (`run_worker` in
/// lib.rs) does that only after it has published `LiveStatus::Running`, so
/// a consumer that observes the `started` event on the queue can never
/// race ahead of `ls_status`/`ls_accept`/`ls_decline` still reporting the
/// service as not running yet.
pub async fn start(config: StartConfig) -> Result<Service, String> {
    let data_dir = PathBuf::from(&config.data_dir);
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("dataDir: {e}"))?;
    let download_dir = PathBuf::from(&config.download_dir);
    std::fs::create_dir_all(&download_dir).map_err(|e| format!("downloadDir: {e}"))?;
    // Narrow window: a just-stopped prior worker (ls_stop detaches and
    // gives it up to ~2s to tear down server/discovery) could still be
    // touching this same inbox if ls_start is called again immediately.
    // Harmless in practice (worst case a stray leftover partial file), and
    // not worth serializing start/stop for.
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
                // `list_devices` polls `discovery.devices()` on demand
                // instead of streaming updates, so nobody consumes discovery
                // events here.
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
        identity,
        port,
        server: Arc::new(server),
        discovery,
        server_stop: Some(server_stop),
        discovery_stop: Some(discovery_stop),
        pending: Arc::new(Mutex::new(HashMap::new())),
        receiving: Arc::new(Mutex::new(HashMap::new())),
        send_cancel: Arc::new(Mutex::new(None)),
        multicast_error,
        download_dir,
    };
    spawn_event_pump(&service, server_rx);
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

/// Accepts a pending receive request. Registers the `ReceiveSession` in
/// `receiving` BEFORE sending the `Accept` decision: the peer can start
/// streaming `FileUpload`s as soon as it sees the decision on the wire, and
/// `handle_file_upload` drops any upload whose session isn't registered
/// yet, so sending first would race the first file against its own
/// registration. If the decision channel is already closed (the request
/// ended on the wire while it was pending), the insert is rolled back.
pub fn accept(pending: &PendingMap, receiving: &ReceivingMap, session_id: &str) -> bool {
    let Some(entry) = lock(pending).remove(session_id) else {
        return false;
    };
    let ids: HashSet<String> = entry.files.keys().cloned().collect();
    lock(receiving).insert(session_id.to_string(), ReceiveSession::default());
    if entry
        .decision_tx
        .send(PrepareUploadDecisionV2::Accept(ids))
        .is_err()
    {
        // The request already ended on the wire; undo the registration.
        lock(receiving).remove(session_id);
        return false;
    }
    true
}

pub fn decline(pending: &PendingMap, session_id: &str) -> bool {
    let Some(entry) = lock(pending).remove(session_id) else {
        return false;
    };
    let _ = entry.decision_tx.send(PrepareUploadDecisionV2::Decline);
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

/// Peers discovered so far, as reported to Lua by `list_devices`. Ported
/// from `device_payloads` in
/// apps/readest-app/src-tauri/src/localsend/service.rs.
pub fn device_payloads(discovery: &DiscoveryHandle) -> Vec<DevicePayload> {
    discovery
        .devices()
        .into_iter()
        .filter_map(|stateful| {
            let http = stateful.get_best_channel().and_then(|c| c.http())?;
            // The best channel may be IPv6; a multi-homed device usually also
            // has an IPv4 channel, whose last octet is the "#<n>" tag shown
            // in the UI.
            let ipv4_host = stateful
                .get_ranked_channels()
                .into_iter()
                .filter_map(|channel| channel.http())
                .map(|http| http.host.as_str())
                .find(|host| host.parse::<std::net::Ipv4Addr>().is_ok())
                .map(str::to_string);
            Some(DevicePayload {
                alias: stateful.device.alias.clone(),
                device_model: stateful.device.device_model.clone(),
                device_type: events::device_type_str(&stateful.device.device_type),
                fingerprint: stateful.device.fingerprint.clone(),
                host: http.host.clone(),
                port: http.port,
                protocol: http.protocol.as_str().to_string(),
                ipv4_host,
            })
        })
        .collect()
}

fn spawn_event_pump(service: &Service, mut server_rx: mpsc::Receiver<ServerEventV2>) {
    let pending = service.pending.clone();
    let receiving = service.receiving.clone();
    let send_cancel = service.send_cancel.clone();
    let download_dir = service.download_dir.clone();
    let discovery = service.discovery.clone();
    let self_fingerprint = service.identity.fingerprint.clone();
    tokio::spawn(async move {
        while let Some(event) = server_rx.recv().await {
            // Register is handled here, in the async pump, so it can await
            // `add_device`; every other event is synchronous. A peer answering
            // this device's announcement (or probing it during a scan)
            // registers over HTTP -- feed it into discovery so `list_devices`
            // learns who answered. Without this, only multicast responders
            // (e.g. macOS) ever appear; iOS (no multicast entitlement) and
            // Android answer over HTTP and would stay invisible.
            if let ServerEventV2::Register { ip, info } = event {
                let host = match ip.scope_id {
                    Some(scope_id) => format!("{}%{scope_id}", ip.ip),
                    None => ip.ip.to_string(),
                };
                register_peer(&discovery, &self_fingerprint, host, info).await;
            } else {
                handle_server_event(&pending, &receiving, &send_cancel, &download_dir, event);
            }
        }
    });
}

/// Puts a peer that registered with this device's HTTP server into the
/// discovery store, so `device_payloads`/`list_devices` report it. Its own
/// registrations (multicast loopback of a scan probing this host) are ignored
/// by fingerprint. Ported from `register_peer` in
/// apps/readest-app/src-tauri/src/localsend/service.rs.
pub async fn register_peer(
    discovery: &DiscoveryHandle,
    self_fingerprint: &str,
    host: String,
    info: RegisterDtoV2,
) {
    if info.fingerprint == self_fingerprint {
        return;
    }
    let device = DiscoveredDevice {
        alias: info.alias,
        version: info.version,
        device_model: info.device_model,
        device_type: info.device_type,
        fingerprint: info.fingerprint,
        channel: DeviceChannel::Http(HttpChannel {
            host,
            port: info.port,
            protocol: info.protocol,
        }),
        download: info.download,
    };
    discovery.add_device(device).await;
}

fn handle_server_event(
    pending: &PendingMap,
    receiving: &ReceivingMap,
    send_cancel: &SendCancelSlot,
    download_dir: &Path,
    event: ServerEventV2,
) {
    match event {
        // Register is intercepted in spawn_event_pump (it needs to await
        // discovery.add_device), so it never reaches this synchronous handler.
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
        ServerEventV2::CancelReceived { ip, session_id } => {
            // The peer cancelled a session this device is sending.
            let guard = lock(send_cancel);
            if let Some(cancel) = guard.as_ref() {
                if cancel.session_id.as_deref() == Some(session_id.as_str())
                    && cancel.host == ip.ip.to_string()
                {
                    cancel.by_peer.store(true, Ordering::Relaxed);
                    cancel.token.cancel();
                }
            }
        }
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

/// Best-effort MIME type from a file name's extension, matching the first
/// entry of `MIMETYPES` in apps/readest-app/src/libs/document.ts for every
/// format Readest recognizes. Unlike the Tauri app (whose frontend already
/// knows the MIME type of every file it offers), the helper only gets a raw
/// path from Lua, so this has no upstream equivalent to port.
fn guess_file_type(file_name: &str) -> String {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("epub") => "application/epub+zip",
        Some("pdf") => "application/pdf",
        Some("mobi") => "application/x-mobipocket-ebook",
        Some("azw") => "application/vnd.amazon.ebook",
        Some("azw3") => "application/vnd.amazon.mobi8-ebook",
        Some("cbz") => "application/vnd.comicbook+zip",
        Some("fb2") => "application/x-fictionbook+xml",
        Some("fbz") => "application/x-zip-compressed-fb2",
        Some("txt") => "text/plain",
        Some("md") => "text/markdown",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Builds one `SendFileJob` per path that still exists, skipping the rest.
/// Errors only when nothing survives. Ported from the `FileDto` construction
/// in `localsend_send_files`
/// (apps/readest-app/src-tauri/src/localsend/commands.rs), except the id is
/// the path's index (no frontend-picked id exists here) and `file_type` is
/// guessed from the extension (no frontend-supplied MIME type exists here).
fn build_send_jobs(paths: &[String]) -> Result<Vec<SendFileJob>, String> {
    let mut jobs = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        let path = PathBuf::from(path);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        jobs.push(SendFileJob {
            dto: FileDto {
                id: i.to_string(),
                file_name: file_name.clone(),
                size: meta.len(),
                file_type: guess_file_type(&file_name),
                sha256: None,
                preview: None,
                metadata: None,
            },
            path,
        });
    }
    if jobs.is_empty() {
        return Err("no valid files to send".to_string());
    }
    Ok(jobs)
}

/// Guards a new send: rejects it while another one is in flight, and
/// resolves the target device by fingerprint. Split out from `start_send` so
/// it is testable without a bound `Service` (no server/multicast needed).
fn resolve_send_target(
    discovery: &DiscoveryHandle,
    send_cancel: &SendCancelSlot,
    fingerprint: &str,
) -> Result<localsend::discovery::StatefulDevice, String> {
    if lock(send_cancel).is_some() {
        return Err("another transfer is in progress".to_string());
    }
    discovery
        .device_by_fingerprint(fingerprint)
        .ok_or_else(|| "device is no longer visible".to_string())
}

/// Starts sending `paths` to the peer identified by `fingerprint`. Mirrors
/// `localsend_send_files`
/// (apps/readest-app/src-tauri/src/localsend/commands.rs): guard against a
/// transfer already in progress, resolve the device, build the file jobs,
/// install the cancellation state, then spawn `run_send`.
pub fn start_send(service: &Service, fingerprint: &str, paths: Vec<String>) -> Result<(), String> {
    let device = resolve_send_target(&service.discovery, &service.send_cancel, fingerprint)?;
    let jobs = build_send_jobs(&paths)?;
    *lock(&service.send_cancel) = Some(SendCancel {
        token: CancellationToken::new(),
        by_peer: Arc::new(AtomicBool::new(false)),
        session_id: None,
        host: String::new(),
    });
    tokio::spawn(run_send(
        service.identity.clone(),
        service.port,
        device,
        jobs,
        service.send_cancel.clone(),
    ));
    Ok(())
}

/// Cancels the active send, if any. Mirrors `localsend_cancel_send`
/// (apps/readest-app/src-tauri/src/localsend/commands.rs).
pub fn cancel_send(service: &Service) {
    if let Some(cancel) = lock(&service.send_cancel).as_ref() {
        cancel.token.cancel();
    }
}

/// Sends the given files to a device: prepare-upload, then one upload per
/// accepted file, sequentially. Progress and the final outcome are queued as
/// `Event::SendProgress` / `Event::SendEnd`. Always clears the send slot
/// before returning. Ported from `run_send` in
/// apps/readest-app/src-tauri/src/localsend/service.rs, with `app.emit(...)`
/// calls replaced by `events::push(...)`.
pub async fn run_send(
    identity: Arc<Identity>,
    port: u16,
    device: localsend::discovery::StatefulDevice,
    jobs: Vec<SendFileJob>,
    cancel_slot: SendCancelSlot,
) {
    use futures_util::StreamExt;
    use localsend::http::client::v2::LsHttpClientV2;
    use localsend::http::client::ClientError;
    use localsend::http::dto_v2::PrepareUploadRequestDtoV2;
    use localsend::model::transfer::FileContent;
    use tokio_stream::wrappers::ReceiverStream;

    let end =
        |session_id: Option<String>, status: &str, error: Option<String>, files_sent: usize| {
            lock(&cancel_slot).take();
            events::push(&Event::SendEnd {
                session_id,
                status: status.to_string(),
                error,
                files_sent,
            });
        };
    let fail = |error: String| end(None, "error", Some(error), 0);

    let Some((host, peer_port, protocol)) = device
        .get_best_channel()
        .and_then(|c| c.http())
        .map(|http| (http.host.clone(), http.port, http.protocol))
    else {
        return fail("device has no reachable address".into());
    };
    let expected_fingerprint = match protocol {
        ProtocolType::Https => Some(device.device.fingerprint.clone()),
        ProtocolType::Http => None,
    };
    let client = match LsHttpClientV2::try_new(
        &identity.key_pem,
        &identity.cert_pem,
        expected_fingerprint,
        None,
    ) {
        Ok(client) => client,
        Err(err) => return fail(format!("client setup failed: {err}")),
    };

    let token = lock(&cancel_slot)
        .as_ref()
        .map(|c| c.token.clone())
        .unwrap_or_default();
    let files: HashMap<String, FileDto> = jobs
        .iter()
        .map(|j| (j.dto.id.clone(), j.dto.clone()))
        .collect();
    let payload = PrepareUploadRequestDtoV2 {
        info: identity.register_dto(port),
        files: files.clone(),
    };
    let prepared = match client
        .prepare_upload(
            protocol,
            &host,
            peer_port,
            None,
            payload,
            None,
            token.clone(),
        )
        .await
    {
        Ok(prepared) => prepared,
        Err(ClientError::Cancelled) => return end(None, "cancelled", None, 0),
        Err(ClientError::StatusCode(err)) => {
            let (status, message) = match err.status {
                401 => (
                    "error",
                    "PIN protected receivers are not supported yet".to_string(),
                ),
                403 => ("declined", String::new()),
                409 => ("error", "busy with another transfer".to_string()),
                429 => ("error", "too many requests".to_string()),
                code => ("error", format!("request failed with status {code}")),
            };
            return end(None, status, (!message.is_empty()).then_some(message), 0);
        }
        Err(err) => return fail(err.to_string()),
    };
    let Some(response) = prepared.response else {
        // 204: every offered file was declined.
        return end(None, "declined", None, 0);
    };
    if let Some(cancel) = lock(&cancel_slot).as_mut() {
        cancel.session_id = Some(response.session_id.clone());
        cancel.host = host.clone();
    }

    let bytes_total: u64 = response
        .files
        .keys()
        .filter_map(|id| files.get(id))
        .map(|f| f.size)
        .sum();
    let files_total = response.files.len();
    let mut sent_bytes = 0u64;
    let mut sent_files = 0usize;

    // Upload sequentially in a stable order.
    let mut file_ids: Vec<&String> = response.files.keys().collect();
    file_ids.sort_by_key(|id| &files[*id].file_name);
    for file_id in file_ids {
        let job = jobs.iter().find(|j| &j.dto.id == file_id).unwrap();
        let body = {
            let session_id = response.session_id.clone();
            let base = sent_bytes;
            let files_done = sent_files;
            let mut streamed = 0u64;
            let mut last_emit = std::time::Instant::now();
            let stream = ReceiverStream::new(FileContent::Path(job.path.clone()).into_receiver())
                .map(move |chunk: bytes::Bytes| {
                    streamed += chunk.len() as u64;
                    if last_emit.elapsed() >= std::time::Duration::from_millis(250) {
                        last_emit = std::time::Instant::now();
                        events::push(&Event::SendProgress {
                            session_id: session_id.clone(),
                            bytes_done: base + streamed,
                            bytes_total,
                            files_done,
                            files_total,
                        });
                    }
                    Ok::<bytes::Bytes, anyhow::Error>(chunk)
                });
            localsend::reqwest::Body::wrap_stream(stream)
        };
        match client
            .upload(
                protocol,
                &host,
                peer_port,
                None,
                &response.session_id,
                file_id,
                &response.files[file_id],
                body,
                token.clone(),
            )
            .await
        {
            Ok(()) => {
                sent_files += 1;
                sent_bytes += files[file_id].size;
            }
            Err(ClientError::Cancelled) => {
                let by_peer = lock(&cancel_slot)
                    .as_ref()
                    .map(|c| c.by_peer.load(Ordering::Relaxed))
                    .unwrap_or(false);
                if !by_peer {
                    // Cancelled locally: the receiver does not know yet.
                    let _ = client
                        .cancel(protocol, &host, peer_port, &response.session_id)
                        .await;
                }
                return end(Some(response.session_id), "cancelled", None, sent_files);
            }
            Err(err) => {
                let _ = client
                    .cancel(protocol, &host, peer_port, &response.session_id)
                    .await;
                return end(
                    Some(response.session_id),
                    "error",
                    Some(format!(
                        "failed to upload {}: {err}",
                        files[file_id].file_name
                    )),
                    sent_files,
                );
            }
        }
    }
    end(Some(response.session_id), "sent", None, sent_files);
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

    #[test]
    fn accept_registers_session_before_the_decision_is_sent() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let receiving: ReceivingMap = Arc::new(Mutex::new(HashMap::new()));
        let (decision_tx, mut decision_rx) = oneshot::channel();
        pending.lock().unwrap().insert(
            "s1".to_string(),
            PendingReceive {
                files: HashMap::new(),
                decision_tx,
            },
        );

        assert!(accept(&pending, &receiving, "s1"));

        // The session must already be registered by the time a peer can
        // react to the Accept decision, closing the race where a
        // FileUpload for the first file arrives before its session does.
        assert!(receiving.lock().unwrap().contains_key("s1"));
        assert!(matches!(
            decision_rx.try_recv(),
            Ok(PrepareUploadDecisionV2::Accept(_))
        ));
    }

    #[test]
    fn accept_rolls_back_the_session_when_the_decision_channel_is_closed() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let receiving: ReceivingMap = Arc::new(Mutex::new(HashMap::new()));
        let (decision_tx, decision_rx) = oneshot::channel();
        drop(decision_rx); // request already ended on the wire
        pending.lock().unwrap().insert(
            "s1".to_string(),
            PendingReceive {
                files: HashMap::new(),
                decision_tx,
            },
        );

        assert!(!accept(&pending, &receiving, "s1"));
        assert!(!receiving.lock().unwrap().contains_key("s1"));
    }

    #[test]
    fn guess_file_type_maps_known_extensions_and_falls_back() {
        assert_eq!(guess_file_type("book.epub"), "application/epub+zip");
        assert_eq!(guess_file_type("book.PDF"), "application/pdf");
        assert_eq!(guess_file_type("book.txt"), "text/plain");
        assert_eq!(guess_file_type("book.xyz"), "application/octet-stream");
        assert_eq!(guess_file_type("no_extension"), "application/octet-stream");
    }

    #[test]
    fn build_send_jobs_skips_missing_paths_and_keeps_original_index_as_id() {
        let dir = std::env::temp_dir().join(format!("lsffi-bsj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real_path = dir.join("book.epub");
        std::fs::write(&real_path, b"hello").unwrap();

        let paths = vec![
            dir.join("missing.epub").to_string_lossy().into_owned(),
            real_path.to_string_lossy().into_owned(),
        ];
        let jobs = build_send_jobs(&paths).unwrap();

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].dto.id, "1"); // original index, the missing entry at 0 was skipped
        assert_eq!(jobs[0].dto.file_name, "book.epub");
        assert_eq!(jobs[0].dto.size, 5);
        assert_eq!(jobs[0].dto.file_type, "application/epub+zip");
        assert_eq!(jobs[0].path, real_path);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_send_jobs_errors_when_no_path_exists() {
        let paths = vec!["/does/not/exist/a.epub".to_string()];
        assert!(build_send_jobs(&paths).is_err());
    }

    /// Discovery bound to port 0 (never a real multicast socket), matching
    /// `test_discovery` in
    /// apps/readest-app/src-tauri/src/localsend/service.rs's own tests.
    async fn test_discovery(alias: &str) -> Arc<DiscoveryHandle> {
        let dir = std::env::temp_dir().join(format!(
            "lsffi-disc-{alias}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let identity = Identity::load_or_generate(
            &dir,
            alias.to_string(),
            "KOReader".into(),
            localsend::model::discovery::DeviceType::Mobile,
        )
        .unwrap();
        let (_stop_tx, stop_rx) = oneshot::channel::<()>();
        let discovery = Arc::new(
            localsend::discovery::start(
                DiscoveryConfig {
                    group: DEFAULT_MULTICAST_GROUP,
                    group_v6: None,
                    port: 0,
                    interface_filter: InterfaceFilter::default(),
                    device: identity.multicast_device(FIRST_PORT),
                    identity: identity.device_identity(),
                    timeout: DEFAULT_DISCOVERY_TIMEOUT,
                    event_tx: None,
                },
                stop_rx,
            )
            .await,
        );
        let _ = std::fs::remove_dir_all(&dir);
        discovery
    }

    fn register_dto(fingerprint: &str) -> RegisterDtoV2 {
        RegisterDtoV2 {
            alias: "Phone".into(),
            version: "2.1".into(),
            device_model: Some("Android".into()),
            device_type: None,
            fingerprint: fingerprint.into(),
            port: FIRST_PORT,
            protocol: ProtocolType::Https,
            download: false,
        }
    }

    // An iOS/Android peer answers over HTTP /register; register_peer must feed
    // it into discovery so list_devices reports it (the bug where KOReader saw
    // only multicast responders like macOS).
    #[tokio::test]
    async fn register_peer_adds_answering_device() {
        let discovery = test_discovery("Reader").await;
        register_peer(
            &discovery,
            "self-fp",
            "192.168.2.135".into(),
            register_dto("peer-fp"),
        )
        .await;

        let devices = device_payloads(&discovery);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].fingerprint, "peer-fp");
        assert_eq!(devices[0].host, "192.168.2.135");
        assert_eq!(devices[0].port, FIRST_PORT);
    }

    // A device's own scan probes loop back to its HTTP server; those carry our
    // own fingerprint and must not register us as our own peer.
    #[tokio::test]
    async fn register_peer_ignores_own_fingerprint() {
        let discovery = test_discovery("Reader").await;
        register_peer(
            &discovery,
            "self-fp",
            "192.168.2.120".into(),
            register_dto("self-fp"),
        )
        .await;

        assert!(device_payloads(&discovery).is_empty());
    }

    #[tokio::test]
    async fn device_payloads_reports_type_and_ipv4_host() {
        use localsend::discovery::{DeviceChannel, DiscoveredDevice, HttpChannel};
        use localsend::model::discovery::DeviceType;

        let discovery = test_discovery("Reader").await;
        discovery
            .add_device(DiscoveredDevice {
                alias: "Phone".into(),
                version: "2.1".into(),
                device_model: Some("Android".into()),
                device_type: Some(DeviceType::Mobile),
                fingerprint: "peer-fp".into(),
                channel: DeviceChannel::Http(HttpChannel {
                    host: "192.168.2.135".into(),
                    port: FIRST_PORT,
                    protocol: ProtocolType::Https,
                }),
                download: false,
            })
            .await;

        let devices = device_payloads(&discovery);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].fingerprint, "peer-fp");
        assert_eq!(devices[0].device_type.as_deref(), Some("mobile"));
        assert_eq!(devices[0].host, "192.168.2.135");
        assert_eq!(devices[0].ipv4_host.as_deref(), Some("192.168.2.135"));
    }

    #[tokio::test]
    async fn resolve_send_target_rejects_a_second_concurrent_send() {
        let discovery = test_discovery("Busy").await;
        let send_cancel: SendCancelSlot = Arc::new(Mutex::new(Some(SendCancel {
            token: CancellationToken::new(),
            by_peer: Arc::new(AtomicBool::new(false)),
            session_id: None,
            host: String::new(),
        })));

        let err = resolve_send_target(&discovery, &send_cancel, "any-fp").unwrap_err();
        assert!(err.contains("progress"), "{err}");
    }

    #[tokio::test]
    async fn resolve_send_target_rejects_unknown_fingerprint() {
        let discovery = test_discovery("Unknown").await;
        let send_cancel: SendCancelSlot = Arc::new(Mutex::new(None));

        let err = resolve_send_target(&discovery, &send_cancel, "no-such-fp").unwrap_err();
        assert!(err.contains("visible"), "{err}");
    }

    #[tokio::test]
    async fn resolve_send_target_finds_device_by_fingerprint() {
        use localsend::discovery::{DeviceChannel, DiscoveredDevice, HttpChannel};
        use localsend::model::discovery::DeviceType;

        let discovery = test_discovery("Found").await;
        discovery
            .add_device(DiscoveredDevice {
                alias: "Laptop".into(),
                version: "2.1".into(),
                device_model: Some("macOS".into()),
                device_type: Some(DeviceType::Desktop),
                fingerprint: "target-fp".into(),
                channel: DeviceChannel::Http(HttpChannel {
                    host: "192.168.2.10".into(),
                    port: FIRST_PORT,
                    protocol: ProtocolType::Https,
                }),
                download: false,
            })
            .await;
        let send_cancel: SendCancelSlot = Arc::new(Mutex::new(None));

        let device = resolve_send_target(&discovery, &send_cancel, "target-fp").unwrap();
        assert_eq!(device.device.fingerprint, "target-fp");
    }
}
