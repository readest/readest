use super::events::*;
use super::service::{self, RunningService};
use super::LocalSendState;
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Emitter, Runtime, State};

/// Whether an interface can carry LocalSend peers, i.e. whether its address is
/// worth reporting as this device's "#<n>" tag.
///
/// VPN tunnels (tun0/utun4/ppp0/wg0) and the cellular link (pdp_ip0) carry
/// addresses no peer on the LAN can reach, so a tag naming one is a number the
/// user can never match against what a peer shows. An iPhone on Wi-Fi with
/// cellular up reported three tags for this reason.
fn is_lan_interface(name: &str) -> bool {
    !["tun", "utun", "ppp", "wg", "pdp_ip"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

fn local_ips() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .iter()
        .filter(|iface| is_lan_interface(iface.name.as_str()))
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
            _ => None,
        })
        .collect()
}

fn status_of(service: &RunningService) -> LocalSendStatus {
    LocalSendStatus {
        running: true,
        alias: service.identity.alias.clone(),
        port: service.port,
        fingerprint: service.identity.fingerprint.clone(),
        device_model: service.identity.device_model.clone(),
        local_ips: local_ips(),
        multicast_error: service.multicast_error.clone(),
    }
}

fn stopped_status() -> LocalSendStatus {
    LocalSendStatus {
        running: false,
        alias: String::new(),
        port: 0,
        fingerprint: String::new(),
        device_model: String::new(),
        local_ips: Vec::new(),
        multicast_error: None,
    }
}

#[tauri::command]
pub async fn localsend_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, LocalSendState>,
    alias: String,
    device_model: String,
) -> Result<LocalSendStatus, String> {
    let mut guard = state.0.lock().await;
    if let Some(service) = guard.as_ref() {
        return Ok(status_of(service));
    }
    match service::start(app.clone(), alias, device_model).await {
        Ok(service) => {
            let status = status_of(&service);
            let _ = app.emit(
                EV_SERVER_STATE,
                ServerStatePayload {
                    running: true,
                    port: status.port,
                    error: None,
                },
            );
            *guard = Some(service);
            Ok(status)
        }
        Err(err) => {
            let _ = app.emit(
                EV_SERVER_STATE,
                ServerStatePayload {
                    running: false,
                    port: 0,
                    error: Some(err.clone()),
                },
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn localsend_stop<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, LocalSendState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(mut service) = guard.take() {
        service::stop(&mut service).await;
    }
    let _ = app.emit(
        EV_SERVER_STATE,
        ServerStatePayload {
            running: false,
            port: 0,
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn localsend_get_status(
    state: State<'_, LocalSendState>,
) -> Result<LocalSendStatus, String> {
    let guard = state.0.lock().await;
    Ok(guard.as_ref().map(status_of).unwrap_or_else(stopped_status))
}

#[tauri::command]
pub async fn localsend_list_devices(
    state: State<'_, LocalSendState>,
) -> Result<Vec<DevicePayload>, String> {
    let guard = state.0.lock().await;
    Ok(guard
        .as_ref()
        .map(|s| service::device_payloads(&s.discovery, &s.departed))
        .unwrap_or_default())
}

#[tauri::command]
pub async fn localsend_announce(
    state: State<'_, LocalSendState>,
    scan: bool,
) -> Result<(), String> {
    let discovery = {
        let guard = state.0.lock().await;
        let Some(service) = guard.as_ref() else {
            return Ok(());
        };
        service.discovery.clone()
    };
    discovery.announce().await;
    // Keep already-known peers present over unicast. Multicast alone re-confirms
    // a peer only when its answer traverses the network; on setups that carry
    // the initial scan but not ongoing multicast (Xiaomi/MIUI, APs that drop or
    // rate-limit multicast), a peer found once would age out of the picker at
    // the presence TTL. Re-probing just the known channels - not a full subnet
    // scan - re-confirms any that still answer, on every heartbeat beat.
    let known_channels = service::known_reprobe_channels(&discovery.devices());
    if !known_channels.is_empty() {
        let _ = discovery.discover_known_http_channels(known_channels).await;
    }
    if scan {
        // HTTP fallback for networks/platforms without multicast (iOS):
        // probe every host on each local /24. LocalSend apps sit on the
        // protocol default port, Readest peers on the first port of their
        // own range, so both are probed.
        use localsend::model::discovery::ProtocolType;
        for iface in if_addrs::get_if_addrs().unwrap_or_default() {
            if let std::net::IpAddr::V4(ip) = iface.ip() {
                if !ip.is_loopback() {
                    for port in SCAN_PORTS {
                        let _ = discovery.scan_subnet(ip, port, ProtocolType::Https).await;
                    }
                }
            }
        }
    }
    Ok(())
}

/// Whether the running service can still be reached. The webview calls this
/// when the app returns to the foreground: on iOS the listening socket does
/// not survive suspension, and nothing reports that, so `running: true` alone
/// is not proof the service works (see [`service::listener_is_alive`]).
#[tauri::command]
pub async fn localsend_is_alive(state: State<'_, LocalSendState>) -> Result<bool, String> {
    let port = {
        let guard = state.0.lock().await;
        guard.as_ref().map(|service| service.port)
    };
    match port {
        Some(port) => Ok(service::listener_is_alive(port).await),
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn localsend_set_discoverable(
    state: State<'_, LocalSendState>,
    active: bool,
) -> Result<(), String> {
    // Presence gate, not a connection: when this device's screen locks or the
    // app is backgrounded, it stops answering announcements, so peers age it
    // out of their pickers within a few seconds (AirDrop style). On return it
    // answers again and announces once, so open pickers re-list it at once.
    let (discovery, identity, port) = {
        let guard = state.0.lock().await;
        let Some(service) = guard.as_ref() else {
            return Ok(());
        };
        (
            service.discovery.clone(),
            service.identity.clone(),
            service.port,
        )
    };
    discovery.set_answer_announcements(active);
    if active {
        discovery.announce().await;
    }
    // Multicast never reaches an iOS peer (no multicast entitlement), and a
    // device that just went dark keeps answering probes for its whole grace
    // window, so peers would hold its tile for 10-15s. Tell them directly:
    // the real port means "back", DEPARTURE_PORT means "going dark".
    let notify_port = if active {
        port
    } else {
        service::DEPARTURE_PORT
    };
    service::notify_peers(&identity, &discovery, notify_port).await;
    Ok(())
}

/// The ports a subnet scan probes: the LocalSend app's fixed port and the
/// first port of Readest's own range (see [`service::PORT_RANGE`]).
const SCAN_PORTS: [u16; 2] = [localsend::multicast::DEFAULT_PORT, service::FIRST_PORT];

#[tauri::command]
pub async fn localsend_respond<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, LocalSendState>,
    session_id: String,
    accept_file_ids: Option<Vec<String>>,
) -> Result<bool, String> {
    use localsend::http::server::v2::PrepareUploadDecisionV2;
    let guard = state.0.lock().await;
    let Some(service) = guard.as_ref() else {
        return Ok(false);
    };
    let Some(pending) = service.pending.lock().unwrap().remove(&session_id) else {
        // Already answered in another window, or aborted by the sender.
        return Ok(false);
    };
    let _ = app.emit(
        EV_RECEIVE_REQUEST_CLOSED,
        SessionRefPayload {
            session_id: session_id.clone(),
        },
    );
    let ids: HashSet<String> = accept_file_ids.unwrap_or_default().into_iter().collect();
    if ids.is_empty() {
        let _ = pending.decision_tx.send(PrepareUploadDecisionV2::Decline);
        return Ok(true);
    }
    let accepted: HashMap<String, localsend::model::transfer::FileDto> = pending
        .files
        .iter()
        .filter(|(id, _)| ids.contains(*id))
        .map(|(id, f)| (id.clone(), f.clone()))
        .collect();
    let bytes_total: u64 = accepted.values().map(|f| f.size).sum();
    if pending
        .decision_tx
        .send(PrepareUploadDecisionV2::Accept(ids))
        .is_err()
    {
        // The request already ended on the wire.
        return Ok(false);
    }
    service.receiving.lock().unwrap().insert(
        session_id.clone(),
        service::ReceiveSession {
            sender: pending.sender,
            files: accepted,
            bytes_total,
            finished_files: 0,
            failed_files: 0,
            finalized_bytes: 0,
            in_progress: HashMap::new(),
            ended: None,
        },
    );
    service::spawn_receive_progress_ticker(app, service.receiving.clone(), session_id);
    Ok(true)
}

#[tauri::command]
pub async fn localsend_cancel_receive(
    state: State<'_, LocalSendState>,
    session_id: String,
) -> Result<(), String> {
    use localsend::http::client::v2::LsHttpClientV2;
    use localsend::model::discovery::ProtocolType;
    let (server, identity, sender) = {
        let guard = state.0.lock().await;
        let Some(service) = guard.as_ref() else {
            return Ok(());
        };
        let Some(sender) =
            service
                .receiving
                .lock()
                .unwrap()
                .get(&session_id)
                .map(|s| service::SenderTarget {
                    host: s.sender.host.clone(),
                    port: s.sender.port,
                    protocol: s.sender.protocol,
                    fingerprint: s.sender.fingerprint.clone(),
                })
        else {
            return Ok(());
        };
        (service.server.clone(), service.identity.clone(), sender)
    };
    server.cancel_v2_session(&session_id).await;
    // Best effort: without it the sender only notices through its failing
    // upload requests.
    let expected = match sender.protocol {
        ProtocolType::Https => Some(sender.fingerprint.clone()),
        ProtocolType::Http => None,
    };
    if let Ok(client) = LsHttpClientV2::try_new(
        &identity.key_pem,
        &identity.cert_pem,
        expected,
        Some(std::time::Duration::from_secs(5)),
    ) {
        let _ = client
            .cancel(sender.protocol, &sender.host, sender.port, &session_id)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn localsend_send_files<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, LocalSendState>,
    fingerprint: String,
    files: Vec<SendFileInput>,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    let Some(service) = guard.as_ref() else {
        return Err("LocalSend is not running".into());
    };
    if service.send_cancel.lock().unwrap().is_some() {
        return Err("another transfer is in progress".into());
    }
    let Some(device) = service.discovery.device_by_fingerprint(&fingerprint) else {
        return Err("device is no longer visible".into());
    };
    let mut jobs = Vec::new();
    for input in files {
        let path = std::path::PathBuf::from(&input.path);
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        jobs.push(service::SendFileJob {
            dto: localsend::model::transfer::FileDto {
                id: uuid::Uuid::new_v4().to_string(),
                file_name: input.file_name,
                size,
                file_type: input.mime_type,
                sha256: None,
                preview: input.preview,
                metadata: None,
            },
            path,
        });
    }
    *service.send_cancel.lock().unwrap() = Some(service::SendCancel {
        token: tokio_util::sync::CancellationToken::new(),
        by_peer: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        session_id: None,
        host: String::new(),
    });
    tauri::async_runtime::spawn(service::run_send(
        app,
        service.identity.clone(),
        service.port,
        device,
        jobs,
        service.send_cancel.clone(),
    ));
    Ok(())
}

#[tauri::command]
pub async fn localsend_cancel_send(state: State<'_, LocalSendState>) -> Result<(), String> {
    let guard = state.0.lock().await;
    if let Some(service) = guard.as_ref() {
        if let Some(cancel) = service.send_cancel.lock().unwrap().as_ref() {
            cancel.token.cancel();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_interfaces_exclude_tunnels_and_cellular() {
        for name in ["en0", "en8", "bridge100", "awdl0", "eth0"] {
            assert!(is_lan_interface(name), "{name} can carry LAN peers");
        }
        // pdp_ip0 is the iPhone's cellular link: reachable by nobody on the
        // LAN, so its last octet must never become this device's tag.
        for name in ["tun0", "utun4", "ppp0", "wg0", "pdp_ip0", "pdp_ip1"] {
            assert!(!is_lan_interface(name), "{name} carries no LAN peers");
        }
    }

    #[test]
    fn scan_covers_localsend_and_readest_ports() {
        // The scan must find LocalSend apps (protocol default port) and
        // Readest peers, which bind the first free port of their own range.
        assert_eq!(SCAN_PORTS[0], localsend::multicast::DEFAULT_PORT);
        assert_eq!(SCAN_PORTS[1], *service::PORT_RANGE.start());
    }
}
