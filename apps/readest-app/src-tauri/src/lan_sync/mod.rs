//! LAN sync peer server: exposes this device's file-sync "remote" tree to
//! other Readest devices on the local network.
//!
//! The tree mirrors the frozen remote layout of `services/sync/file/layout.ts`
//! (`/Readest/library.json`, `/Readest/books/<hash>/config.json`, ...) on disk
//! under `<app_data_dir>/LanSync/`. The TS side talks to it through
//! `LanSyncProvider` (a `FileSyncProvider` backend), so from the engine's point
//! of view a LAN peer is just another WebDAV-like root — merge policy, triggers
//! and conflict handling are all inherited unchanged.
//!
//! Security model (home-LAN scope, see docs/lan-sync-proposal.md §6):
//!   - the default mode is direct plaintext LAN access; an optional shared
//!     `Authorization: Bearer <token>` can restrict requests when configured;
//!   - request paths are lexically normalised and must stay inside the root
//!     (no `..`, no separators smuggled inside segments, no drive letters);
//!   - plaintext HTTP is a deliberate trade-off; upgrading to the localsend
//!     self-signed TLS stack is a possible future hardening that does not
//!     change the sync semantics.

pub mod server;

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use md5::{Digest, Md5};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::{oneshot, watch, Mutex};

/// Readest's LAN sync port. LocalSend deliberately avoids 53317 (and we avoid
/// the localsend-in-Readest range 53318-53327); 53430 is unclaimed territory.
/// Consumed by the settings UI as the default both sides serve on.
#[allow(dead_code)]
pub const DEFAULT_PORT: u16 = 53430;
/// Number of extra ports to try when the requested one is taken.
const PORT_FALLBACK: u16 = 10;
const MDNS_SERVICE_TYPE: &str = "_readest-lan-sync._tcp.local.";
const MDNS_DISCOVERY_WINDOW: Duration = Duration::from_secs(3);
const SERVER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Tauri managed state: the running LAN sync server, or `None` while the
/// integration is disabled. The epoch rejects stale starts from other windows.
#[derive(Default)]
pub struct LanSyncState {
    pub server: Arc<Mutex<Option<RunningServer>>>,
    pub generation: AtomicU64,
}

pub struct RunningServer {
    pub port: u16,
    pub device_name: String,
    pub device_id: String,
    token: String,
    stop_tx: watch::Sender<bool>,
    task: tauri::async_runtime::JoinHandle<()>,
    mdns: Option<ServiceDaemon>,
}

#[derive(Clone, Serialize)]
pub struct LanSyncStatus {
    running: bool,
    port: u16,
    device_name: String,
    device_id: String,
    local_ips: Vec<String>,
    /// Monotonic process-wide epoch used to reject stale starts.
    generation: u64,
    /// MD5 fingerprint used by the UI to detect a stale server token without
    /// exposing the token itself through lifecycle status.
    token_fingerprint: String,
    /// True only when this start call created the running server.
    started: bool,
}

/// Benchmark/test networks are commonly used by TUN and proxy adapters, not
/// by peers on a home LAN. Keep them out even when the interface name is not
/// descriptive (notably on Windows).
fn is_benchmark_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 198 && (b == 18 || b == 19)
}

fn is_usable_ipv4(ip: Ipv4Addr) -> bool {
    (ip.is_private() || ip.is_link_local())
        && !ip.is_loopback()
        && !ip.is_broadcast()
        && !is_benchmark_ipv4(ip)
}

/// Prefer RFC1918 addresses while retaining a deterministic fallback for
/// unusual but usable private-LAN arrangements.
fn preferred_ipv4<I>(ips: I) -> Option<Ipv4Addr>
where
    I: IntoIterator<Item = Ipv4Addr>,
{
    let mut candidates: Vec<Ipv4Addr> = ips.into_iter().filter(|ip| is_usable_ipv4(*ip)).collect();
    candidates.sort_by_key(|ip| (!ip.is_private(), ip.octets()));
    candidates.into_iter().next()
}

/// LAN-facing addresses of this device, VPN tunnels excluded. Same filter as
/// `localsend::commands::local_ips`: tun/utun/ppp/wg interfaces carry addresses
/// peers on the LAN never see, and listing them just produces confusing
/// "#2"-suffixed entries in the pairing form.
fn local_ips() -> Vec<String> {
    let mut ips: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .iter()
        .filter(|iface| {
            let name = iface.name.as_str();
            !["tun", "utun", "ppp", "wg"]
                .iter()
                .any(|prefix| name.starts_with(prefix))
        })
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(ip) if is_usable_ipv4(ip) => Some(ip),
            _ => None,
        })
        .collect();
    ips.sort_by_key(|ip| (!ip.is_private(), ip.octets()));
    ips.dedup();
    ips.into_iter().map(|ip| ip.to_string()).collect()
}

fn token_fingerprint(token: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn status_of(server: &RunningServer, generation: u64) -> LanSyncStatus {
    LanSyncStatus {
        running: true,
        port: server.port,
        device_name: server.device_name.clone(),
        device_id: server.device_id.clone(),
        local_ips: local_ips(),
        token_fingerprint: token_fingerprint(&server.token),
        generation,
        started: false,
    }
}

fn stopped_status(generation: u64) -> LanSyncStatus {
    LanSyncStatus {
        running: false,
        port: 0,
        device_name: String::new(),
        device_id: String::new(),
        local_ips: Vec::new(),
        token_fingerprint: String::new(),
        generation,
        started: false,
    }
}

async fn shutdown_running_server(server: RunningServer) {
    let _ = server.stop_tx.send(true);
    if let Some(mdns) = server.mdns {
        let _ = mdns.shutdown();
    }
    let mut task = server.task;
    if tokio::time::timeout(SERVER_SHUTDOWN_TIMEOUT, &mut task)
        .await
        .is_err()
    {
        task.abort();
        let _ = task.await;
    }
}

/// Generate the identity used by the /ping handshake when no persisted id
/// exists. The caller stores it below the app data directory for stable
/// self-discovery filtering across restarts.
fn new_device_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn is_valid_device_id(id: &str) -> bool {
    id.len() == 32 && id.is_ascii() && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_valid_device_id(path: &Path) -> Result<Option<String>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("lan_sync: inspect device id: {e}")),
    };
    if !metadata.file_type().is_file() {
        return Err(format!("lan_sync: device id is not a regular file: {}", path.display()));
    }
    let id = std::fs::read_to_string(path)
        .map_err(|e| format!("lan_sync: read device id: {e}"))?;
    let id = id.trim();
    Ok(is_valid_device_id(id).then(|| id.to_string()))
}

fn remove_device_id_file(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
            std::fs::remove_file(path)
                .map_err(|e| format!("lan_sync: remove legacy device id: {e}"))?;
        }
        Ok(_) => {
            return Err(format!(
                "lan_sync: legacy device id is not a file: {}",
                path.display()
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("lan_sync: inspect legacy device id: {e}")),
    }
    Ok(())
}

fn write_device_id(path: &Path, id: &str) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if !metadata.file_type().is_file() {
            return Err(format!("lan_sync: device id is not a regular file: {}", path.display()));
        }
    }
    std::fs::write(path, id).map_err(|e| format!("lan_sync: persist device id: {e}"))
}

fn load_device_id(app_data_dir: &Path) -> Result<String, String> {
    let metadata_dir = app_data_dir.join("LanSyncMeta");
    match std::fs::symlink_metadata(&metadata_dir) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("lan_sync: device metadata dir must not be a symlink".to_string());
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("lan_sync: device metadata path must be a directory".to_string());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(&metadata_dir)
                .map_err(|e| format!("lan_sync: create device metadata dir: {e}"))?;
        }
        Err(e) => return Err(format!("lan_sync: inspect device metadata dir: {e}")),
    }
    let path = metadata_dir.join("device_id");
    // Migrate the pre-hardening identity out of the HTTP-served root so an
    // upgrade does not leave the old file visible to LAN peers.
    let legacy_path = app_data_dir.join("LanSync").join("device_id");
    if let Some(id) = read_valid_device_id(&path)? {
        remove_device_id_file(&legacy_path)?;
        return Ok(id);
    }
    if let Some(id) = read_valid_device_id(&legacy_path)? {
        write_device_id(&path, &id)?;
        remove_device_id_file(&legacy_path)?;
        return Ok(id);
    }
    remove_device_id_file(&legacy_path)?;

    let id = new_device_id();
    write_device_id(&path, &id)?;
    Ok(id)
}

fn mdns_instance_name(device_name: &str, device_id: &str) -> String {
    let safe_name: String = device_name
        .chars()
        .map(|c| if c.is_control() { '_' } else { c })
        .collect();
    format!("{safe_name} {}", &device_id[..device_id.len().min(8)])
}

fn advertise_mdns(
    device_name: &str,
    device_id: &str,
    token: &str,
    port: u16,
) -> Result<ServiceDaemon, String> {
    let addresses = local_ips();
    if addresses.is_empty() {
        return Err("lan_sync: no non-loopback IPv4 address for mDNS".to_string());
    }
    let mdns = ServiceDaemon::new().map_err(|e| format!("lan_sync: start mDNS: {e}"))?;
    let instance = mdns_instance_name(device_name, device_id);
    let hostname = format!("readest-{}.local.", &device_id[..device_id.len().min(12)]);
    let auth_mode = if token.is_empty() { "none" } else { "required" };
    let mut properties: HashMap<String, String> = HashMap::from([
        ("device_id".to_string(), device_id.to_string()),
        ("name".to_string(), device_name.to_string()),
        ("auth".to_string(), auth_mode.to_string()),
        ("proto".to_string(), "readest-lan-sync-1".to_string()),
    ]);
    if !token.is_empty() {
        properties.insert("token_fingerprint".to_string(), token_fingerprint(token));
    }
    let info = match ServiceInfo::new(
        MDNS_SERVICE_TYPE,
        &instance,
        &hostname,
        addresses.join(","),
        port,
        properties,
    ) {
        Ok(info) => info,
        Err(e) => {
            let _ = mdns.shutdown();
            return Err(format!("lan_sync: build mDNS service: {e}"));
        }
    };
    if let Err(e) = mdns.register(info) {
        let _ = mdns.shutdown();
        return Err(format!("lan_sync: publish mDNS service: {e}"));
    }
    Ok(mdns)
}

#[derive(Clone, Serialize)]
pub struct DiscoveredPeer {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub device_id: String,
    pub token: String,
    pub auth_required: bool,
}

fn discover_mdns() -> Result<Vec<DiscoveredPeer>, String> {
    let mdns = ServiceDaemon::new().map_err(|e| format!("lan_sync: start mDNS browse: {e}"))?;
    let receiver = mdns
        .browse(MDNS_SERVICE_TYPE)
        .map_err(|e| format!("lan_sync: browse mDNS services: {e}"))?;
    let deadline = Instant::now() + MDNS_DISCOVERY_WINDOW;
    let mut peers = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let props = info.get_properties();
                // Missing metadata means an older token-protected peer; only an
                // explicit `auth=none` advertises anonymous access.
                let auth_required = props.get_property_val_str("auth") != Some("none");
                let device_id = props
                    .get_property_val_str("device_id")
                    .unwrap_or("")
                    .to_string();
                if device_id.is_empty() || peers.iter().any(|p: &DiscoveredPeer| p.device_id == device_id) {
                    continue;
                }
                let name = props
                    .get_property_val_str("name")
                    .map(ToString::to_string)
                    .unwrap_or_else(|| info.get_fullname().to_string());
                let host = preferred_ipv4(info.get_addresses_v4().into_iter().copied())
                    .map(|ip| ip.to_string())
                    .unwrap_or_default();
                if host.is_empty() {
                    continue;
                }
                peers.push(DiscoveredPeer {
                    name,
                    host,
                    port: info.get_port(),
                    device_id,
                    // Tokens are exchanged out-of-band; never expose them in
                    // mDNS metadata.
                    token: String::new(),
                    auth_required,
                });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = mdns.stop_browse(MDNS_SERVICE_TYPE);
    let _ = mdns.shutdown();
    Ok(peers)
}

#[tauri::command]
pub async fn lan_sync_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, LanSyncState>,
    token: String,
    port: u16,
    device_name: String,
    expected_generation: Option<u64>,
) -> Result<LanSyncStatus, String> {
    let token = token.trim().to_string();
    let device_name = {
        let trimmed = device_name.trim();
        if trimmed.is_empty() {
            "Readest".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let mut guard = state.server.lock().await;
    let generation = state.generation.load(Ordering::SeqCst);
    if expected_generation.is_some_and(|expected| expected != generation) {
        return Ok(match guard.as_ref() {
            Some(server) => status_of(server, generation),
            None => stopped_status(generation),
        });
    }
    if let Some(server) = guard.as_ref() {
        if server.token == token {
            return Ok(status_of(server, generation));
        }
    }

    // A token change or a start from stopped is a new lifecycle intent. Advance
    // the epoch before doing any fallible work so a failed replacement cannot
    // leave stale callers with an apparently current generation.
    let start_generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(server) = guard.take() {
        // Keep stop and start under the same state mutex so a stale caller
        // cannot resurrect an old server after a disconnect.
        shutdown_running_server(server).await;
    }

    let app_data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("lan_sync: app data dir: {e}"))?;
    let root = app_data_dir.join("LanSync");
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("lan_sync: sync root must not be a symlink".to_string());
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("lan_sync: sync root must be a directory".to_string());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(&root)
                .map_err(|e| format!("lan_sync: create root: {e}"))?;
        }
        Err(e) => return Err(format!("lan_sync: inspect root: {e}")),
    }

    let device_id = load_device_id(&app_data_dir)?;
    let server_state = Arc::new(server::ServerState {
        root,
        auth_token: (!token.is_empty()).then(|| token.clone()),
        device_name: device_name.clone(),
        device_id,
    });

    // Bind the requested port, walking upwards through a small fallback range
    // when it is taken (same resilience philosophy as localsend's port walk).
    let mut bound = None;
    let mut last_err = String::new();
    for p in port..=port.saturating_add(PORT_FALLBACK) {
        match tokio::net::TcpListener::bind(("0.0.0.0", p)).await {
            Ok(listener) => {
                bound = Some((listener, p));
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let Some((listener, bound_port)) = bound else {
        return Err(format!(
            "lan_sync: no bindable port in {port}-{}: {last_err}",
            port.saturating_add(PORT_FALLBACK)
        ));
    };

    let (stop_tx, mut stop_rx) = watch::channel(false);
    let router = server::router(server_state.clone());
    let (ready_tx, ready_rx) = oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        // The listener is already bound before this task is spawned. Signal
        // readiness before advertising so mDNS never points at a not-yet-live
        // TCP endpoint.
        let _ = ready_tx.send(());
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = stop_rx.changed().await;
            })
            .await;
    });
    let _ = ready_rx.await;

    // mDNS is an optional convenience for pairing. A missing IPv4 address or
    // an mDNS daemon failure must not prevent authenticated manual TCP use.
    let mdns = match advertise_mdns(
        &device_name,
        &server_state.device_id,
        &token,
        bound_port,
    ) {
        Ok(mdns) => Some(mdns),
        Err(e) => {
            log::warn!("{e}");
            None
        }
    };

    let running = RunningServer {
        port: bound_port,
        device_name,
        device_id: server_state.device_id.clone(),
        token,
        stop_tx,
        task,
        mdns,
    };
    let mut status = status_of(&running, start_generation);
    status.started = true;
    *guard = Some(running);
    Ok(status)
}

#[tauri::command]
pub async fn lan_sync_stop(
    state: State<'_, LanSyncState>,
    expected_generation: Option<u64>,
) -> Result<LanSyncStatus, String> {
    let mut guard = state.server.lock().await;
    let current_generation = state.generation.load(Ordering::SeqCst);
    if expected_generation.is_some_and(|expected| expected != current_generation) {
        return Ok(match guard.as_ref() {
            Some(server) => status_of(server, current_generation),
            None => stopped_status(current_generation),
        });
    }

    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(server) = guard.take() {
        shutdown_running_server(server).await;
    }
    Ok(stopped_status(generation))
}

#[tauri::command]
pub async fn lan_sync_discover() -> Result<Vec<DiscoveredPeer>, String> {
    tauri::async_runtime::spawn_blocking(discover_mdns)
        .await
        .map_err(|e| format!("lan_sync: discovery task failed: {e}"))?
}

#[tauri::command]
pub async fn lan_sync_status(state: State<'_, LanSyncState>) -> Result<LanSyncStatus, String> {
    let guard = state.server.lock().await;
    let generation = state.generation.load(Ordering::SeqCst);
    Ok(match guard.as_ref() {
        Some(server) => status_of(server, generation),
        None => stopped_status(generation),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_benchmark_ipv4_addresses() {
        assert!(is_benchmark_ipv4(Ipv4Addr::new(198, 18, 0, 1)));
        assert!(is_benchmark_ipv4(Ipv4Addr::new(198, 19, 255, 254)));
        assert!(!is_benchmark_ipv4(Ipv4Addr::new(192, 168, 1, 9)));
    }

    #[test]
    fn prefers_private_ipv4_addresses() {
        assert_eq!(
            preferred_ipv4([
                Ipv4Addr::new(198, 18, 0, 1),
                Ipv4Addr::new(8, 8, 8, 8),
                Ipv4Addr::new(192, 168, 1, 9),
            ]),
            Some(Ipv4Addr::new(192, 168, 1, 9)),
        );
        assert_eq!(
            preferred_ipv4([Ipv4Addr::new(198, 18, 0, 1), Ipv4Addr::new(8, 8, 8, 8)]),
            Some(Ipv4Addr::new(8, 8, 8, 8)),
        );
    }
}
