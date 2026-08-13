//! localsend-helper: static-musl process spawned by the KOReader Lua plugin.
//! Binds 127.0.0.1:<control-port>, accepts ONE connection, then speaks
//! newline-delimited JSON: Lua sends {"cmd":...}; we stream {"type":...} events.
//! Runs the LocalSend service (both receive and send). No glibc dependency
//! (static musl) so it runs on ancient e-reader kernels where an FFI cdylib
//! segfaults.

use localsend_bin::{
    config::StartConfig,
    events::{self, Event},
    service,
};
use serde::Deserialize;
use std::io::Write as _;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Notify};

/// First line on the control socket. Reuses `StartConfig`'s camelCase field
/// names but is its own type so the wire command (which also carries `cmd`)
/// stays decoupled from the reusable library's config shape.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCmd {
    cmd: String,
    alias: String,
    device_model: String,
    device_type: String,
    data_dir: String,
    download_dir: String,
}

/// Every subsequent line on the control socket.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cmd {
    cmd: String,
    session_id: Option<String>,
    fingerprint: Option<String>,
    paths: Option<Vec<String>>,
}

fn parse_control_port() -> Option<u16> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--control-port" {
            return args.next()?.parse().ok();
        }
    }
    None
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let Some(port) = parse_control_port() else {
        eprintln!("usage: localsend-helper --control-port <u16>");
        std::process::exit(2);
    };

    let listener = match TcpListener::bind(("127.0.0.1", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("bind 127.0.0.1:{port}: {err}");
            std::process::exit(2);
        }
    };

    // Lets the Lua side (and tests/protocol.rs) confirm readiness without
    // racing the bind.
    println!("localsend-helper ready port={port}");
    let _ = std::io::stdout().flush();

    let stream = match tokio::time::timeout(Duration::from_secs(30), listener.accept()).await {
        Ok(Ok((stream, _addr))) => stream,
        Ok(Err(err)) => {
            eprintln!("accept: {err}");
            std::process::exit(2);
        }
        Err(_elapsed) => {
            // Lua never connected within 30s; nothing to clean up.
            std::process::exit(0);
        }
    };

    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    let first_line = match lines.next_line().await {
        Ok(Some(line)) => line,
        Ok(None) => {
            write_error(&mut wr, "connection closed before start command").await;
            std::process::exit(1);
        }
        Err(err) => {
            write_error(&mut wr, &format!("read error: {err}")).await;
            std::process::exit(1);
        }
    };

    let start_cmd: StartCmd = match serde_json::from_str(&first_line) {
        Ok(cmd) => cmd,
        Err(err) => {
            write_error(&mut wr, &format!("bad start command: {err}")).await;
            std::process::exit(1);
        }
    };
    if start_cmd.cmd != "start" {
        write_error(&mut wr, "first command must be \"start\"").await;
        std::process::exit(1);
    }

    let config = StartConfig {
        alias: start_cmd.alias,
        device_model: start_cmd.device_model,
        device_type: start_cmd.device_type,
        data_dir: start_cmd.data_dir,
        download_dir: start_cmd.download_dir,
    };

    events::clear();
    let mut svc = match service::start(config).await {
        Ok(svc) => svc,
        Err(err) => {
            write_error(&mut wr, &err).await;
            std::process::exit(1);
        }
    };
    // service::start deliberately does not push Event::Started itself (see
    // its doc comment): the caller pushes it only once the service is fully
    // ready to accept accept/decline/status commands. The forwarder task
    // below picks it up on its first drain pass.
    events::push(&Event::Started {
        alias: svc.alias.clone(),
        port: svc.port,
    });

    // Signaled by the reader loop below (on "stop"/EOF/read error) to tell
    // the forwarder to do one last drain and exit.
    let forwarder_stop = Arc::new(Notify::new());
    let forwarder_stop_signal = forwarder_stop.clone();
    // Signaled by the forwarder if a write to the socket fails (Lua died):
    // the reader loop must not be left blocked on a read that will never
    // produce more data in that case.
    let (forwarder_died_tx, mut forwarder_died_rx) = oneshot::channel::<()>();

    let forwarder = tokio::spawn(async move {
        loop {
            if drain_events(&mut wr).await.is_err() {
                let _ = forwarder_died_tx.send(());
                return;
            }
            tokio::select! {
                _ = events::notified() => {}
                _ = forwarder_stop_signal.notified() => {
                    // A push can race the stop signal; drain once more
                    // before exiting so nothing queued is lost.
                    let _ = drain_events(&mut wr).await;
                    return;
                }
            }
        }
    });

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if dispatch(&line, &svc) {
                            break; // "stop"
                        }
                    }
                    Ok(None) => break, // EOF: Lua closed the socket
                    Err(_) => break,
                }
            }
            _ = &mut forwarder_died_rx => break,
        }
    }

    forwarder_stop.notify_one();
    let _ = forwarder.await;

    service::stop(&mut svc).await;
    std::process::exit(0);
}

/// Returns `true` when the caller should stop the reader loop (a "stop"
/// command was received).
fn dispatch(line: &str, svc: &service::Service) -> bool {
    let Ok(cmd) = serde_json::from_str::<Cmd>(line) else {
        return false; // ignore unparseable lines
    };
    match cmd.cmd.as_str() {
        "accept" => {
            if let Some(id) = &cmd.session_id {
                let _ = service::accept(&svc.pending, &svc.receiving, id);
            }
        }
        "decline" => {
            if let Some(id) = &cmd.session_id {
                let _ = service::decline(&svc.pending, id);
            }
        }
        "status" => {
            events::push(&Event::Status {
                running: true,
                alias: Some(svc.alias.clone()),
                port: Some(svc.port),
                local_ips: service::local_ips(),
                multicast_error: svc.multicast_error.clone(),
            });
        }
        "list_devices" => {
            events::push(&Event::Devices {
                devices: service::device_payloads(&svc.discovery),
            });
        }
        "send" => {
            if let (Some(fingerprint), Some(paths)) = (cmd.fingerprint, cmd.paths) {
                if let Err(err) = service::start_send(svc, &fingerprint, paths) {
                    events::push(&Event::SendEnd {
                        session_id: None,
                        status: "error".into(),
                        error: Some(err),
                        files_sent: 0,
                    });
                }
            }
        }
        "cancel_send" => service::cancel_send(svc),
        "stop" => return true,
        // Unknown command: ignored.
        _ => {}
    }
    false
}

/// Writes every currently queued event to `wr` as newline-delimited JSON.
async fn drain_events(wr: &mut OwnedWriteHalf) -> std::io::Result<()> {
    while let Some(json) = events::pop() {
        wr.write_all(json.as_bytes()).await?;
        wr.write_all(b"\n").await?;
    }
    wr.flush().await
}

async fn write_error(wr: &mut OwnedWriteHalf, message: &str) {
    let json = serde_json::to_string(&Event::Error {
        message: message.to_string(),
    })
    .unwrap_or_else(|_| r#"{"type":"error","message":"internal error"}"#.to_string());
    let _ = wr.write_all(json.as_bytes()).await;
    let _ = wr.write_all(b"\n").await;
    let _ = wr.flush().await;
}
