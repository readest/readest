//! The running LocalSend service: HTTPS server + discovery + the event pump
//! that translates protocol events into `localsend:*` webview events. The
//! receive/send flows mirror the upstream LocalSend CLI (Apache-2.0).

use crate::localsend::events::*;
use crate::localsend::identity::Identity;
use localsend::discovery::{
    DeviceChannel, DiscoveredDevice, DiscoveryConfig, DiscoveryEvent, DiscoveryHandle, HttpChannel,
    StatefulDevice, DEFAULT_DISCOVERY_TIMEOUT,
};
use localsend::http::client::{LsHttpClient, LsHttpClientVersion};
use localsend::http::dto_v2::RegisterDtoV2;
use localsend::http::server::common::save::FileUploadTarget;
use localsend::http::server::v2::{PrepareUploadDecisionV2, ServerEventV2, SessionEndReasonV2};
use localsend::http::server::web::{WebConfig, WebMode};
use localsend::http::server::{start_with_port, ServerConfigV2, ServerHandle};
use localsend::model::discovery::ProtocolType;
use localsend::model::transfer::FileDto;
use localsend::multicast::{DEFAULT_MULTICAST_GROUP, DEFAULT_MULTICAST_GROUP_V6, DEFAULT_PORT};
use localsend::util::interface::InterfaceFilter;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

/// Readest deliberately skips the LocalSend default HTTP port 53317 and binds
/// the next port up. The LocalSend app has no port fallback, so leaving 53317
/// free lets both run on one device. Discovery still works: the multicast
/// socket shares UDP 53317 (SO_REUSEPORT) and every announce carries Readest's
/// real HTTP port, so peers reach it on whatever port it bound.
pub const FIRST_PORT: u16 = 53318;
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = FIRST_PORT..=53327;

pub type PendingMap = Arc<StdMutex<HashMap<String, PendingReceive>>>;
pub type ReceivingMap = Arc<StdMutex<HashMap<String, ReceiveSession>>>;
pub type SendCancelSlot = Arc<StdMutex<Option<SendCancel>>>;

/// Where to reach the sender of a receive session, for receiver-side cancel.
pub struct SenderTarget {
    pub host: String,
    pub port: u16,
    pub protocol: ProtocolType,
    pub fingerprint: String,
}

/// An incoming transfer request waiting for the user's decision.
pub struct PendingReceive {
    pub sender: SenderTarget,
    pub files: HashMap<String, FileDto>,
    pub decision_tx: oneshot::Sender<PrepareUploadDecisionV2>,
}

/// An accepted upload session being received.
pub struct ReceiveSession {
    pub sender: SenderTarget,
    pub files: HashMap<String, FileDto>,
    pub bytes_total: u64,
    pub finished_files: usize,
    pub failed_files: usize,
    pub finalized_bytes: u64,
    pub in_progress: HashMap<String, Arc<AtomicU64>>,
    /// Set when the server reported the session end; the summary event is
    /// deferred until every in-flight per-file result has been emitted.
    pub ended: Option<SessionEndReasonV2>,
}

/// Cancellation state of the (single) active send session.
pub struct SendCancel {
    pub token: CancellationToken,
    /// Set (before triggering `token`) when the receiver requested the
    /// cancellation; only a local cancellation still notifies the receiver.
    pub by_peer: Arc<AtomicBool>,
    pub session_id: Option<String>,
    pub host: String,
}

pub struct SendFileJob {
    pub dto: FileDto,
    pub path: std::path::PathBuf,
}

pub struct RunningService {
    pub identity: Arc<Identity>,
    pub port: u16,
    pub server: Arc<ServerHandle>,
    pub discovery: Arc<DiscoveryHandle>,
    pub server_stop: Option<oneshot::Sender<()>>,
    pub discovery_stop: Option<oneshot::Sender<()>>,
    pub pending: PendingMap,
    pub receiving: ReceivingMap,
    pub send_cancel: SendCancelSlot,
    /// Peers that said goodbye, and when. See [`DEPARTURE_PORT`].
    pub departed: DepartedPeers,
    pub multicast_error: Option<String>,
}

pub async fn start<R: Runtime>(
    app: AppHandle<R>,
    alias: String,
    device_model: String,
) -> Result<RunningService, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("localsend");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let identity = Arc::new(
        Identity::load_or_generate(&dir, alias, device_model).map_err(|e| format!("{e:#}"))?,
    );

    // Bind the HTTPS server on Readest's own port range (see PORT_RANGE:
    // 53317 is left to the LocalSend app), walking it for the first free port.
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
            // `WebMode::Upload` makes TLS client certificates optional:
            // upstream derives `mandatory_client_auth` from the web share
            // being `Disabled`, so any active web mode flips it off. The
            // stable LocalSend app presents no client certificate, and with
            // mandatory auth its connections are reset during the handshake.
            // Cert-less senders fall back to the body fingerprint, exactly
            // like classic protocol v2.1. The upload page itself is a bonus:
            // browsers without LocalSend can send books, gated by the same
            // accept dialog as any transfer.
            WebConfig {
                mode: WebMode::Upload,
                ..Default::default()
            },
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

    // Discovery: multicast plus the register answers to other devices'
    // announcements. Multicast failure is not fatal; the store still
    // collects devices that contact this device over HTTP.
    let (discovery_tx, discovery_rx) = mpsc::channel::<DiscoveryEvent>(16);
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
                event_tx: Some(discovery_tx),
            },
            discovery_stop_rx,
        )
        .await,
    );
    let multicast_error = discovery.multicast_error().map(|e| format!("{e:#}"));
    {
        // Announce this device; peers answer with an HTTP register request.
        let discovery = discovery.clone();
        tauri::async_runtime::spawn(async move { discovery.announce().await });
    }

    let service = RunningService {
        identity,
        port,
        server: Arc::new(server),
        discovery,
        server_stop: Some(server_stop),
        discovery_stop: Some(discovery_stop),
        pending: Arc::new(StdMutex::new(HashMap::new())),
        receiving: Arc::new(StdMutex::new(HashMap::new())),
        send_cancel: Arc::new(StdMutex::new(None)),
        departed: Arc::new(StdMutex::new(HashMap::new())),
        multicast_error,
    };
    spawn_event_pump(app, &service, server_rx, discovery_rx);
    Ok(service)
}

pub async fn stop(service: &mut RunningService) {
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

fn spawn_event_pump<R: Runtime>(
    app: AppHandle<R>,
    service: &RunningService,
    mut server_rx: mpsc::Receiver<ServerEventV2>,
    mut discovery_rx: mpsc::Receiver<DiscoveryEvent>,
) {
    let discovery = service.discovery.clone();
    let pending = service.pending.clone();
    let receiving = service.receiving.clone();
    let send_cancel = service.send_cancel.clone();
    let departed = service.departed.clone();
    let self_fingerprint = service.identity.fingerprint.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                event = server_rx.recv() => match event {
                    Some(ServerEventV2::Register { ip, info }) => {
                        // A peer answering this device's announcement (or
                        // probing it during a scan) registers with the HTTP
                        // server; feed it into the discovery store, as the
                        // discovery crate documents. Without this, the
                        // announcing side never learns who answered.
                        let host = match ip.scope_id {
                            Some(scope_id) => format!("{}%{scope_id}", ip.ip),
                            None => ip.ip.to_string(),
                        };
                        // A register advertising DEPARTURE_PORT is a goodbye,
                        // not an arrival: the peer is about to go dark and
                        // would otherwise keep answering probes (and so keep
                        // its tile alive) for its whole grace window.
                        if info.port == DEPARTURE_PORT {
                            departed
                                .lock()
                                .unwrap()
                                .insert(info.fingerprint.clone(), SystemTime::now());
                            emit_devices(&app, &discovery, &departed);
                            continue;
                        }
                        departed.lock().unwrap().remove(&info.fingerprint);
                        let discovery = discovery.clone();
                        let self_fingerprint = self_fingerprint.clone();
                        tauri::async_runtime::spawn(async move {
                            register_peer(&discovery, &self_fingerprint, host, info).await;
                        });
                    }
                    Some(event) => {
                        handle_server_event(&app, &pending, &receiving, &send_cancel, event)
                    }
                    None => break,
                },
                event = discovery_rx.recv() => match event {
                    Some(_) => emit_devices(&app, &discovery, &departed),
                    None => break,
                },
            }
        }
    });
}

/// Puts a peer that registered with this device's HTTP server into the
/// discovery store. Its own registrations (multicast loopback of a scan
/// probing this host) are ignored.
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

/// Peers that told us they are going away, and when they said so.
pub type DepartedPeers = Arc<StdMutex<HashMap<String, SystemTime>>>;

/// The port a departing device advertises in its goodbye.
///
/// Presence is otherwise inferred from "does the peer still answer", which is
/// too slow: iOS keeps a locked app running for its background grace window,
/// so a phone whose screen just went off goes on answering re-probes for
/// several seconds and only then ages out at [`PRESENCE_TTL`] - 10 to 15
/// seconds in the list after the user pocketed it. So a device about to go
/// dark says so, over the register route it already speaks, and its peers
/// drop it on the next beat. Port zero means "not listening": no peer can
/// dial it, so a LocalSend client that does not know about goodbyes just
/// records an address it cannot send to until the hello corrects it.
pub const DEPARTURE_PORT: u16 = 0;

/// How long a goodbye keeps a peer out of the list without a matching hello.
///
/// It must outlast the sender's grace window, or the peer's own next answered
/// probe would put it straight back. It is bounded so a hello lost on the way
/// back cannot hide a device that is really there: past this, presence falls
/// back to [`PRESENCE_TTL`], which by then has pruned a peer that truly left.
pub const DEPARTURE_HOLD: Duration = Duration::from_secs(15);

/// A goodbye is best-effort and races the OS suspending us, so it gets one
/// short attempt per peer rather than a retry.
const DEPARTURE_TIMEOUT: Duration = Duration::from_millis(700);

/// Whether a peer that said goodbye at `departed_at` is still held out of the
/// list.
pub fn peer_has_departed(departed_at: Option<SystemTime>, now: SystemTime) -> bool {
    departed_at.is_some_and(|at| {
        now.duration_since(at)
            .map(|age| age < DEPARTURE_HOLD)
            .unwrap_or(true)
    })
}

/// Tells every known peer that this device is going dark (`port`
/// [`DEPARTURE_PORT`]) or is back (its real port), over the register route.
///
/// Best-effort: peers that have gone away themselves simply time out, and the
/// presence TTL still covers every case where this never arrives at all - a
/// crash, a force-quit, or walking out of range.
pub async fn notify_peers(identity: &Identity, discovery: &DiscoveryHandle, port: u16) {
    let channels = known_reprobe_channels(&discovery.devices());
    if channels.is_empty() {
        return;
    }
    // No pinned fingerprint: this is discovery traffic, and the payload says
    // nothing a peer does not already know about us.
    let Ok(client) = LsHttpClient::new(
        &identity.key_pem,
        &identity.cert_pem,
        LsHttpClientVersion::V2,
        None,
        Some(DEPARTURE_TIMEOUT),
    ) else {
        return;
    };
    let dto = identity.client_register_dto(port);
    let sends = channels
        .iter()
        .map(|channel| client.register(channel.protocol, &channel.host, channel.port, dto.clone()));
    futures::future::join_all(sends).await;
}

/// A discovered peer is shown only while it keeps answering presence probes.
/// Once its last confirmation is older than this, the picker drops it, so a
/// device that locked its screen (and stopped answering) disappears within a
/// few seconds, AirDrop style. It is a few multiples of the picker's ~1.5s
/// presence heartbeat, so a single dropped multicast packet never flickers a
/// live peer out of the list.
const PRESENCE_TTL: Duration = Duration::from_millis(4500);

/// Whether a peer whose last confirmation was at `last_seen` is still fresh
/// enough to show. A `None` (a device with no logs, which should not happen)
/// is treated as absent; a timestamp in the future (clock skew) as present.
fn device_is_present(last_seen: Option<SystemTime>, now: SystemTime) -> bool {
    match last_seen {
        Some(ts) => now
            .duration_since(ts)
            .map(|age| age <= PRESENCE_TTL)
            .unwrap_or(true),
        None => false,
    }
}

pub fn device_payloads(
    discovery: &DiscoveryHandle,
    departed: &DepartedPeers,
) -> Vec<DevicePayload> {
    let now = SystemTime::now();
    let departed = departed.lock().unwrap().clone();
    discovery
        .devices()
        .into_iter()
        .filter_map(|stateful| {
            // A peer that announced it is going dark leaves at once, instead of
            // lingering on the TTL it goes on refreshing through its grace window.
            if peer_has_departed(departed.get(&stateful.device.fingerprint).copied(), now) {
                return None;
            }
            // Prune peers that stopped answering (screen locked / app backgrounded).
            let last_seen = stateful.logs.last().map(|log| log.timestamp);
            if !device_is_present(last_seen, now) {
                return None;
            }
            let http = stateful.get_best_channel().and_then(|c| c.http())?;
            // The best channel may be IPv6; a multi-homed device usually also
            // has an IPv4 channel, whose last octet is the "#<n>" tag shown
            // in the UI. Channel ranking follows the most recent confirmation,
            // so picking the first IPv4 there made the tag flicker between a
            // peer's addresses (an iPhone answers on both Wi-Fi and the
            // iPhone-USB link). The tag is an identity label, so choose it
            // deterministically instead: the routable address over an
            // autoconfigured link-local one, then the lowest address.
            let ipv4_host = stateful
                .get_ranked_channels()
                .into_iter()
                .filter_map(|channel| channel.http())
                .filter_map(|http| http.host.parse::<std::net::Ipv4Addr>().ok())
                .min_by_key(|ip| (ip.is_link_local(), *ip))
                .map(|ip| ip.to_string());
            Some(DevicePayload {
                alias: stateful.device.alias.clone(),
                device_model: stateful.device.device_model.clone(),
                device_type: device_type_str(&stateful.device.device_type),
                fingerprint: stateful.device.fingerprint.clone(),
                host: http.host.clone(),
                port: http.port,
                protocol: http.protocol.as_str().to_string(),
                ipv4_host,
            })
        })
        .collect()
}

/// Whether the HTTP server bound to `port` still accepts connections.
///
/// iOS reclaims a suspended app's listening socket, and the accept loop is
/// never woken to notice: `TcpListener::accept` stays pending forever, so
/// [`ServerEventV2::ListenerFailed`] is never emitted and the service looks
/// healthy while no peer can reach it (Nearby BookDrop then went silent until
/// the user toggled the setting off and on). A loopback connect is the only
/// thing that tells the two apart - the OS refuses it once the socket is gone.
pub async fn listener_is_alive(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    matches!(
        tokio::time::timeout(LIVENESS_TIMEOUT, tokio::net::TcpStream::connect(addr)).await,
        Ok(Ok(_))
    )
}

/// A loopback connect either completes or is refused at once; anything longer
/// than this is a wedged socket, which counts as dead.
const LIVENESS_TIMEOUT: Duration = Duration::from_millis(500);

/// The HTTP channels of the currently known peers, for a unicast re-probe.
///
/// A peer stays in the picker only while its presence is re-confirmed within
/// [`PRESENCE_TTL`]. The picker's heartbeat re-confirms peers by announcing
/// over multicast and letting them answer, but networks that carry the initial
/// unicast scan yet drop ongoing multicast — Xiaomi/MIUI power management, or
/// access points that filter or rate-limit multicast — never deliver that
/// answer, so a peer found once would age out within seconds even while it is
/// perfectly reachable. Re-probing each known peer's own channel over unicast
/// re-confirms any that still answer, without the cost of sweeping the whole
/// `/24` on every beat. A peer that genuinely went away (screen locked with the
/// process suspended, service stopped) stops answering the probe too, so it
/// still ages out as before.
pub fn known_reprobe_channels(devices: &[StatefulDevice]) -> Vec<HttpChannel> {
    devices
        .iter()
        .filter_map(|d| d.device.channel.http().cloned())
        .collect()
}

fn emit_devices<R: Runtime>(
    app: &AppHandle<R>,
    discovery: &DiscoveryHandle,
    departed: &DepartedPeers,
) {
    let _ = app.emit(
        EV_DEVICES,
        DevicesPayload {
            devices: device_payloads(discovery, departed),
        },
    );
}

fn handle_server_event<R: Runtime>(
    app: &AppHandle<R>,
    pending: &PendingMap,
    receiving: &ReceivingMap,
    send_cancel: &SendCancelSlot,
    event: ServerEventV2,
) {
    match event {
        // Register events are consumed by the event pump before this point.
        ServerEventV2::Register { .. } => {}
        ServerEventV2::PrepareUpload {
            session_id,
            ip,
            info,
            cert_fingerprint,
            files,
            decision_tx,
        } => {
            // A cert-derived fingerprint is proof of key possession; the body
            // fingerprint is whatever the sender claimed. The webview gates
            // paired auto-accept on this distinction.
            let cert_verified = cert_fingerprint.is_some();
            let sender = SenderTarget {
                host: ip.ip.to_string(),
                port: info.port,
                protocol: info.protocol,
                fingerprint: cert_fingerprint.unwrap_or_else(|| info.fingerprint.clone()),
            };
            let payload = ReceiveRequestPayload {
                session_id: session_id.clone(),
                sender: SenderPayload {
                    alias: info.alias.clone(),
                    device_model: info.device_model.clone(),
                    device_type: device_type_str(&info.device_type),
                    fingerprint: sender.fingerprint.clone(),
                    cert_verified,
                },
                files: files
                    .values()
                    .map(|f| FilePayload {
                        id: f.id.clone(),
                        file_name: f.file_name.clone(),
                        size: f.size,
                        file_type: f.file_type.clone(),
                        preview: f.preview.clone(),
                    })
                    .collect(),
            };
            pending.lock().unwrap().insert(
                session_id,
                PendingReceive {
                    sender,
                    files,
                    decision_tx,
                },
            );
            let _ = app.emit(EV_RECEIVE_REQUEST, payload);
        }
        ServerEventV2::PrepareUploadAborted { session_id } => {
            if pending.lock().unwrap().remove(&session_id).is_some() {
                let _ = app.emit(EV_RECEIVE_REQUEST_CLOSED, SessionRefPayload { session_id });
            }
        }
        ServerEventV2::FileUpload {
            session_id,
            file_id,
            file,
            target_tx,
        } => handle_file_upload(app, receiving, session_id, file_id, file, target_tx),
        ServerEventV2::SessionEnd { session_id, reason } => {
            let mut sessions = receiving.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id) {
                session.ended = Some(reason);
                maybe_emit_receive_end(app, &mut sessions, &session_id);
            }
        }
        ServerEventV2::CancelReceived { ip, session_id } => {
            // The peer cancelled a session this device is sending.
            let guard = send_cancel.lock().unwrap();
            if let Some(cancel) = guard.as_ref() {
                if cancel.session_id.as_deref() == Some(session_id.as_str())
                    && cancel.host == ip.ip.to_string()
                {
                    cancel.by_peer.store(true, Ordering::Relaxed);
                    cancel.token.cancel();
                }
            }
        }
        ServerEventV2::ListenerFailed { error } => {
            // The OS invalidated the listening socket (e.g. iOS reclaims a
            // suspended app's sockets) and the core has stopped the server. The
            // RunningService still held in state is now dead: it would keep
            // being announced (peers list it) but can accept no uploads. Tear it
            // down and report the server stopped, so the foreground lifecycle
            // starts a fresh one instead of re-announcing a dead listener.
            log::warn!("LocalSend HTTP listener failed: {error}");
            if let Some(state) = app.try_state::<crate::localsend::LocalSendState>() {
                let services = state.0.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(mut service) = services.lock().await.take() {
                        stop(&mut service).await;
                    }
                    let _ = app.emit(
                        EV_SERVER_STATE,
                        ServerStatePayload {
                            running: false,
                            port: 0,
                            error: None,
                        },
                    );
                });
            }
        }
    }
}

fn staging_dir<R: Runtime>(app: &AppHandle<R>) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("localsend").join("inbox"))
        .unwrap_or_else(|_| std::env::temp_dir().join("readest-localsend-inbox"))
}

/// "name.epub" -> "name (2).epub" until unused, like the upstream CLI.
fn unique_path(dir: &std::path::Path, file_name: &str) -> std::path::PathBuf {
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

fn handle_file_upload<R: Runtime>(
    app: &AppHandle<R>,
    receiving: &ReceivingMap,
    session_id: String,
    file_id: String,
    file: FileDto,
    target_tx: oneshot::Sender<FileUploadTarget>,
) {
    let progress = Arc::new(AtomicU64::new(0));
    {
        let mut sessions = receiving.lock().unwrap();
        let Some(session) = sessions.get_mut(&session_id) else {
            // Unknown session: dropping target_tx fails the request.
            return;
        };
        session
            .in_progress
            .insert(file_id.clone(), progress.clone());
    }

    let dir = staging_dir(app);
    let _ = std::fs::create_dir_all(&dir);
    let path = unique_path(&dir, &file.file_name);

    let (progress_tx, mut progress_rx) = mpsc::channel::<u64>(16);
    {
        let progress = progress.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(written) = progress_rx.recv().await {
                progress.store(written, Ordering::Relaxed);
            }
        });
    }

    let (result_tx, result_rx) = oneshot::channel::<Result<(), String>>();
    {
        let app = app.clone();
        let receiving = receiving.clone();
        let path = path.clone();
        let file_name = file.file_name.clone();
        tauri::async_runtime::spawn(async move {
            let result = match result_rx.await {
                Ok(result) => result,
                Err(_) => Err("upload aborted".to_string()),
            };
            let mut sessions = receiving.lock().unwrap();
            let Some(session) = sessions.get_mut(&session_id) else {
                let _ = std::fs::remove_file(&path);
                return;
            };
            session.in_progress.remove(&file_id);
            let (saved_path, error) = match result {
                Ok(()) => {
                    session.finished_files += 1;
                    session.finalized_bytes +=
                        session.files.get(&file_id).map(|f| f.size).unwrap_or(0);
                    (Some(path.to_string_lossy().to_string()), None)
                }
                Err(err) => {
                    session.failed_files += 1;
                    let _ = std::fs::remove_file(&path);
                    (None, Some(err))
                }
            };
            let _ = app.emit(
                EV_RECEIVE_FILE_DONE,
                ReceiveFileDonePayload {
                    session_id: session_id.clone(),
                    file_id,
                    file_name,
                    path: saved_path,
                    error,
                },
            );
            maybe_emit_receive_end(&app, &mut sessions, &session_id);
        });
    }

    let _ = target_tx.send(FileUploadTarget::Path {
        path,
        result_tx,
        progress_tx: Some(progress_tx),
    });
}

fn maybe_emit_receive_end<R: Runtime>(
    app: &AppHandle<R>,
    sessions: &mut HashMap<String, ReceiveSession>,
    session_id: &str,
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
    let _ = app.emit(
        EV_RECEIVE_END,
        ReceiveEndPayload {
            session_id: session_id.to_string(),
            reason: reason.to_string(),
            received: session.finished_files,
            failed: session.failed_files,
        },
    );
}

/// Emits `localsend:receive-progress` every 250ms while the session exists.
pub fn spawn_receive_progress_ticker<R: Runtime>(
    app: AppHandle<R>,
    receiving: ReceivingMap,
    session_id: String,
) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(250));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let payload = {
                let sessions = receiving.lock().unwrap();
                let Some(session) = sessions.get(&session_id) else {
                    break;
                };
                let in_flight: u64 = session
                    .in_progress
                    .values()
                    .map(|p| p.load(Ordering::Relaxed))
                    .sum();
                TransferProgressPayload {
                    session_id: session_id.clone(),
                    bytes_done: session.finalized_bytes + in_flight,
                    bytes_total: session.bytes_total,
                    files_done: session.finished_files + session.failed_files,
                    files_total: session.files.len(),
                }
            };
            let _ = app.emit(EV_RECEIVE_PROGRESS, payload);
        }
    });
}

/// Sends the given files to a device: prepare-upload, then one upload per
/// accepted file, sequentially. Progress and the final outcome are emitted
/// as `localsend:send-progress` / `localsend:send-end` events. Always clears
/// the send slot before returning.
pub async fn run_send<R: Runtime>(
    app: AppHandle<R>,
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

    let end = |payload: SendEndPayload| {
        cancel_slot.lock().unwrap().take();
        let _ = app.emit(EV_SEND_END, payload);
    };
    let fail = |error: String| {
        end(SendEndPayload {
            session_id: None,
            status: "error".into(),
            error: Some(error),
            files_sent: 0,
        });
    };

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

    let token = cancel_slot
        .lock()
        .unwrap()
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
        Err(ClientError::Cancelled) => {
            return end(SendEndPayload {
                session_id: None,
                status: "cancelled".into(),
                error: None,
                files_sent: 0,
            });
        }
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
            return end(SendEndPayload {
                session_id: None,
                status: status.into(),
                error: (!message.is_empty()).then_some(message),
                files_sent: 0,
            });
        }
        Err(err) => return fail(err.to_string()),
    };
    let Some(response) = prepared.response else {
        // 204: every offered file was declined.
        return end(SendEndPayload {
            session_id: None,
            status: "declined".into(),
            error: None,
            files_sent: 0,
        });
    };
    if let Some(cancel) = cancel_slot.lock().unwrap().as_mut() {
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
            let app = app.clone();
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
                        let _ = app.emit(
                            EV_SEND_PROGRESS,
                            TransferProgressPayload {
                                session_id: session_id.clone(),
                                bytes_done: base + streamed,
                                bytes_total,
                                files_done,
                                files_total,
                            },
                        );
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
                let by_peer = cancel_slot
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|c| c.by_peer.load(Ordering::Relaxed))
                    .unwrap_or(false);
                if !by_peer {
                    // Cancelled locally: the receiver does not know yet.
                    let _ = client
                        .cancel(protocol, &host, peer_port, &response.session_id)
                        .await;
                }
                return end(SendEndPayload {
                    session_id: Some(response.session_id),
                    status: "cancelled".into(),
                    error: None,
                    files_sent: sent_files,
                });
            }
            Err(err) => {
                let _ = client
                    .cancel(protocol, &host, peer_port, &response.session_id)
                    .await;
                return end(SendEndPayload {
                    session_id: Some(response.session_id),
                    status: "error".into(),
                    error: Some(format!(
                        "failed to upload {}: {err}",
                        files[file_id].file_name
                    )),
                    files_sent: sent_files,
                });
            }
        }
    }
    end(SendEndPayload {
        session_id: Some(response.session_id),
        status: "sent".into(),
        error: None,
        files_sent: sent_files,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No peer has said goodbye in these tests.
    fn no_departures() -> DepartedPeers {
        Arc::new(StdMutex::new(HashMap::new()))
    }

    #[test]
    fn presence_ttl_keeps_recent_and_drops_stale() {
        let now = SystemTime::now();
        // A peer confirmed just now is present.
        assert!(device_is_present(Some(now), now));
        // Within the TTL it stays.
        assert!(device_is_present(
            Some(now - PRESENCE_TTL + Duration::from_millis(500)),
            now
        ));
        // Past the TTL (locked screen, stopped answering) it is pruned.
        assert!(!device_is_present(
            Some(now - PRESENCE_TTL - Duration::from_millis(500)),
            now
        ));
        // Clock skew (future timestamp) is treated as present, never dropped.
        assert!(device_is_present(Some(now + Duration::from_secs(10)), now));
        // A device with no confirmation log is absent.
        assert!(!device_is_present(None, now));
    }

    #[test]
    fn known_reprobe_channels_collects_each_peers_confirmed_http_channel() {
        let peer = |host: &str, port: u16| StatefulDevice {
            device: DiscoveredDevice {
                alias: "peer".into(),
                version: "2.1".into(),
                device_model: None,
                device_type: None,
                fingerprint: host.into(),
                channel: DeviceChannel::Http(HttpChannel {
                    host: host.into(),
                    port,
                    protocol: ProtocolType::Https,
                }),
                download: false,
            },
            channels: HashMap::new(),
            logs: Vec::new(),
        };
        let devices = vec![peer("192.168.2.135", 53318), peer("192.168.2.140", 53318)];
        let channels = known_reprobe_channels(&devices);
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].host, "192.168.2.135");
        assert_eq!(channels[0].port, 53318);
        assert_eq!(channels[0].protocol, ProtocolType::Https);
        assert_eq!(channels[1].host, "192.168.2.140");
        // An empty store yields nothing to re-probe.
        assert!(known_reprobe_channels(&[]).is_empty());
    }

    #[test]
    fn unique_path_appends_counter_before_extension() {
        let dir = std::env::temp_dir().join(format!("ls-up-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "book.epub");
        assert_eq!(first, dir.join("book.epub"));
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "book.epub");
        assert_eq!(second, dir.join("book (2).epub"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn port_range_avoids_localsend_default() {
        // 53317 is left free for the LocalSend app, which has no fallback.
        assert!(!PORT_RANGE.contains(&53317));
        assert_eq!(*PORT_RANGE.start(), FIRST_PORT);
        assert_eq!(*PORT_RANGE.end(), 53327);
    }

    fn test_discovery(identity: &Identity) -> Arc<DiscoveryHandle> {
        // Port 0 keeps the test off the real LocalSend multicast group; the
        // handle works without multicast either way.
        let (_stop_tx, stop_rx) = oneshot::channel::<()>();
        tauri::async_runtime::block_on(localsend::discovery::start(
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
        ))
        .into()
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

    #[test]
    fn register_peer_adds_answering_device() {
        let dir = std::env::temp_dir().join(format!("ls-rp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let identity = Identity::load_or_generate(&dir, "Readest".into(), "macOS".into()).unwrap();
        let discovery = test_discovery(&identity);

        tauri::async_runtime::block_on(register_peer(
            &discovery,
            &identity.fingerprint,
            "192.168.2.135".into(),
            register_dto("peer-fp"),
        ));

        let devices = device_payloads(&discovery, &no_departures());
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].fingerprint, "peer-fp");
        assert_eq!(devices[0].host, "192.168.2.135");
        assert_eq!(devices[0].port, FIRST_PORT);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn device_payload_carries_ipv4_host_for_multi_homed_device() {
        let dir = std::env::temp_dir().join(format!("ls-v4-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let identity = Identity::load_or_generate(&dir, "Readest".into(), "macOS".into()).unwrap();
        let discovery = test_discovery(&identity);

        tauri::async_runtime::block_on(async {
            register_peer(
                &discovery,
                &identity.fingerprint,
                "fe80::5442:82ff:febd:e7eb%3".into(),
                register_dto("peer-fp"),
            )
            .await;
            register_peer(
                &discovery,
                &identity.fingerprint,
                "192.168.2.135".into(),
                register_dto("peer-fp"),
            )
            .await;
        });

        let devices = device_payloads(&discovery, &no_departures());
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].ipv4_host.as_deref(), Some("192.168.2.135"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn device_payload_keeps_the_ipv4_tag_stable_for_a_multi_homed_peer() {
        // A phone on Wi-Fi and on the iPhone-USB link answers on both
        // addresses in turn. The "#<n>" tag must not follow whichever
        // confirmation landed last (it flickered between the two), and must
        // name the routable address rather than the link-local one.
        let dir = std::env::temp_dir().join(format!("ls-mh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let identity = Identity::load_or_generate(&dir, "Readest".into(), "macOS".into()).unwrap();
        let discovery = test_discovery(&identity);

        let confirm = |host: &str| {
            tauri::async_runtime::block_on(register_peer(
                &discovery,
                &identity.fingerprint,
                host.into(),
                register_dto("peer-fp"),
            ));
        };
        let tag_host = || {
            device_payloads(&discovery, &no_departures())[0]
                .ipv4_host
                .clone()
        };

        confirm("192.168.2.99");
        assert_eq!(tag_host().as_deref(), Some("192.168.2.99"));
        confirm("169.254.109.245");
        assert_eq!(
            tag_host().as_deref(),
            Some("192.168.2.99"),
            "a link-local confirmation must not take over the tag"
        );
        confirm("192.168.2.99");
        assert_eq!(tag_host().as_deref(), Some("192.168.2.99"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn listener_is_alive_follows_the_bound_socket() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .unwrap();
            let port = listener.local_addr().unwrap().port();
            assert!(
                listener_is_alive(port).await,
                "a bound listener must answer the probe"
            );

            // Dropping the listener is what the OS does to a suspended iOS
            // app's socket: the port stops accepting while the service still
            // believes it is running.
            drop(listener);
            assert!(
                !listener_is_alive(port).await,
                "a reclaimed socket must fail the probe"
            );
        });
    }

    #[test]
    fn a_goodbye_hides_a_peer_that_is_still_answering() {
        // iOS keeps a locked app running for a few seconds, so the phone goes
        // on answering re-probes after it said goodbye. The hold is what stops
        // the very next probe from putting it straight back in the list.
        let now = SystemTime::now();
        assert!(peer_has_departed(Some(now), now));
        assert!(peer_has_departed(
            Some(now - DEPARTURE_HOLD + Duration::from_secs(1)),
            now
        ));
        // Bounded, so a lost hello cannot hide a live device for good.
        assert!(!peer_has_departed(
            Some(now - DEPARTURE_HOLD - Duration::from_secs(1)),
            now
        ));
        assert!(!peer_has_departed(None, now));
    }

    #[test]
    fn device_payloads_drop_a_peer_that_said_goodbye_until_it_says_hello() {
        let dir = std::env::temp_dir().join(format!("ls-bye-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let identity = Identity::load_or_generate(&dir, "Readest".into(), "macOS".into()).unwrap();
        let discovery = test_discovery(&identity);
        let departed: DepartedPeers = Arc::new(StdMutex::new(HashMap::new()));

        tauri::async_runtime::block_on(register_peer(
            &discovery,
            &identity.fingerprint,
            "192.168.2.99".into(),
            register_dto("peer-fp"),
        ));
        assert_eq!(device_payloads(&discovery, &departed).len(), 1);

        departed
            .lock()
            .unwrap()
            .insert("peer-fp".into(), SystemTime::now());
        assert!(
            device_payloads(&discovery, &departed).is_empty(),
            "a peer that said goodbye must leave the list at once"
        );

        // The hello clears the hold, even though nothing about the peer's
        // last-seen timestamp changed.
        departed.lock().unwrap().remove("peer-fp");
        assert_eq!(device_payloads(&discovery, &departed).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn register_peer_ignores_own_fingerprint() {
        let dir = std::env::temp_dir().join(format!("ls-rs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let identity = Identity::load_or_generate(&dir, "Readest".into(), "macOS".into()).unwrap();
        let discovery = test_discovery(&identity);

        tauri::async_runtime::block_on(register_peer(
            &discovery,
            &identity.fingerprint,
            "192.168.2.120".into(),
            register_dto(&identity.fingerprint.clone()),
        ));

        assert!(device_payloads(&discovery, &no_departures()).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
