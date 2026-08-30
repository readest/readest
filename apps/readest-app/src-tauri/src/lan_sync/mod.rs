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
//!   - every request must carry `Authorization: Bearer <token>`; the token is
//!     generated once by the UI on first enable and shared out-of-band (typed
//!     into the peer's LanForm);
//!   - request paths are lexically normalised and must stay inside the root
//!     (no `..`, no separators smuggled inside segments, no drive letters);
//!   - plaintext HTTP is a deliberate trade-off; upgrading to the localsend
//!     self-signed TLS stack is a possible future hardening that does not
//!     change the sync semantics.

pub mod server;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::{watch, Mutex};

/// Readest's LAN sync port. LocalSend deliberately avoids 53317 (and we avoid
/// the localsend-in-Readest range 53318-53327); 53430 is unclaimed territory.
/// Consumed by the settings UI as the default both sides serve on.
#[allow(dead_code)]
pub const DEFAULT_PORT: u16 = 53430;
/// Number of extra ports to try when the requested one is taken.
const PORT_FALLBACK: u16 = 10;
const MDNS_SERVICE_TYPE: &str = "_readest-lan-sync._tcp.local.";
const MDNS_DISCOVERY_WINDOW: Duration = Duration::from_secs(3);

/// Tauri managed state: the running LAN sync server, or `None` while the
/// integration is disabled. Mirrors `localsend::LocalSendState`.
#[derive(Default)]
pub struct LanSyncState(pub Arc<Mutex<Option<RunningServer>>>);

pub struct RunningServer {
    pub port: u16,
    pub device_name: String,
    pub device_id: String,
    stop_tx: watch::Sender<bool>,
    mdns: ServiceDaemon,
}

#[derive(Clone, Serialize)]
pub struct LanSyncStatus {
    running: bool,
    port: u16,
    device_name: String,
    device_id: String,
    local_ips: Vec<String>,
}

/// LAN-facing addresses of this device, VPN tunnels excluded. Same filter as
/// `localsend::commands::local_ips`: tun/utun/ppp/wg interfaces carry addresses
/// peers on the LAN never see, and listing them just produces confusing
/// "#2"-suffixed entries in the pairing form.
fn local_ips() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .iter()
        .filter(|iface| {
            let name = iface.name.as_str();
            !["tun", "utun", "ppp", "wg"]
                .iter()
                .any(|prefix| name.starts_with(prefix))
        })
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
            _ => None,
        })
        .collect()
}

fn status_of(server: &RunningServer) -> LanSyncStatus {
    LanSyncStatus {
        running: true,
        port: server.port,
        device_name: server.device_name.clone(),
        device_id: server.device_id.clone(),
        local_ips: local_ips(),
    }
}

fn stopped_status() -> LanSyncStatus {
    LanSyncStatus {
        running: false,
        port: 0,
        device_name: String::new(),
        device_id: String::new(),
        local_ips: Vec::new(),
    }
}

/// Fresh per-run identity for the /ping handshake. A persistent id (surviving
/// restarts) matters only for the M1.5 auto-discovery pairing memory; revisit
/// then.
fn new_device_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
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
    let mdns = ServiceDaemon::new().map_err(|e| format!("lan_sync: start mDNS: {e}"))?;
    let instance = mdns_instance_name(device_name, device_id);
    let hostname = format!("readest-{}.local.", &device_id[..device_id.len().min(12)]);
    let properties: HashMap<String, String> = HashMap::from([
        ("device_id".to_string(), device_id.to_string()),
        ("name".to_string(), device_name.to_string()),
        ("token".to_string(), token.to_string()),
        ("proto".to_string(), "readest-lan-sync-1".to_string()),
    ]);
    let info = ServiceInfo::new(
        MDNS_SERVICE_TYPE,
        &instance,
        &hostname,
        "",
        port,
        properties,
    )
    .map_err(|e| format!("lan_sync: build mDNS service: {e}"))?;
    mdns.register(info)
        .map_err(|e| format!("lan_sync: publish mDNS service: {e}"))?;
    Ok(mdns)
}

#[derive(Clone, Serialize)]
pub struct DiscoveredPeer {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub device_id: String,
    pub token: String,
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
                let token = props
                    .get_property_val_str("token")
                    .unwrap_or("")
                    .to_string();
                let host = info
                    .get_addresses_v4()
                    .into_iter()
                    .filter(|ip| !ip.is_loopback())
                    .map(ToString::to_string)
                    .next()
                    .unwrap_or_default();
                if host.is_empty() || token.is_empty() {
                    continue;
                }
                peers.push(DiscoveredPeer {
                    name,
                    host,
                    port: info.get_port(),
                    device_id,
                    token,
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
) -> Result<LanSyncStatus, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("lan_sync: token must not be empty".to_string());
    }
    let device_name = {
        let trimmed = device_name.trim();
        if trimmed.is_empty() {
            "Readest".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let mut guard = state.0.lock().await;
    if let Some(server) = guard.as_ref() {
        return Ok(status_of(server));
    }

    let root: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("lan_sync: app data dir: {e}"))?
        .join("LanSync");
    std::fs::create_dir_all(&root).map_err(|e| format!("lan_sync: create root: {e}"))?;

    let server_state = Arc::new(server::ServerState {
        root,
        token,
        device_name: device_name.clone(),
        device_id: new_device_id(),
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

    let mdns = advertise_mdns(
        &device_name,
        &server_state.device_id,
        &server_state.token,
        bound_port,
    )?;
    let (stop_tx, mut stop_rx) = watch::channel(false);
    let router = server::router(server_state.clone());
    tauri::async_runtime::spawn(async move {
        // Runs until lan_sync_stop flips the watch channel; the join handle is
        // intentionally dropped — graceful shutdown cleans the socket up.
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = stop_rx.changed().await;
            })
            .await;
    });

    let running = RunningServer {
        port: bound_port,
        device_name,
        device_id: server_state.device_id.clone(),
        stop_tx,
        mdns,
    };
    let status = status_of(&running);
    *guard = Some(running);
    Ok(status)
}

#[tauri::command]
pub async fn lan_sync_stop(state: State<'_, LanSyncState>) -> Result<LanSyncStatus, String> {
    let mut guard = state.0.lock().await;
    if let Some(server) = guard.take() {
        let _ = server.stop_tx.send(true);
        let _ = server.mdns.shutdown();
    }
    Ok(stopped_status())
}

#[tauri::command]
pub async fn lan_sync_discover() -> Result<Vec<DiscoveredPeer>, String> {
    tauri::async_runtime::spawn_blocking(discover_mdns)
        .await
        .map_err(|e| format!("lan_sync: discovery task failed: {e}"))?
}

#[tauri::command]
pub async fn lan_sync_status(state: State<'_, LanSyncState>) -> Result<LanSyncStatus, String> {
    let guard = state.0.lock().await;
    Ok(match guard.as_ref() {
        Some(server) => status_of(server),
        None => stopped_status(),
    })
}
