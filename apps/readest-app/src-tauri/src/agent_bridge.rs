//! Loopback bridge for `readness-cli` and other agent clients.
//!
//! Binds `127.0.0.1` on an ephemeral port, writes that port and a per-launch
//! secret to `agent-bridge.json` in the app config dir, and forwards one
//! authenticated `POST /agent` at a time to the main webview. The secret, the
//! request body, and the response body are never logged.

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header::AUTHORIZATION, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const BRIDGE_FILE: &str = "agent-bridge.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY: usize = 64 * 1024;

type Pending = HashMap<String, oneshot::Sender<Value>>;

#[cfg(test)]
#[derive(Clone)]
struct Responder {
    pending: Arc<Mutex<Pending>>,
}

#[cfg(test)]
impl Responder {
    fn send(&self, value: Value) {
        deliver(&self.pending, value);
    }
}

#[derive(Clone)]
struct Shared {
    secret: Arc<str>,
    timeout: Duration,
    pending: Arc<Mutex<Pending>>,
    handler: Arc<dyn Fn(Value) + Send + Sync>,
}

/// `true` only for the IPv4 loopback address the bridge is allowed to use.
fn is_agent_bind_ip(ip: IpAddr) -> bool {
    ip == IpAddr::V4(Ipv4Addr::LOCALHOST)
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run(app).await {
            log::error!("agent bridge: {err}");
        }
    });
}

async fn run(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|err| format!("bind failed: {err}"))?;
    let addr = listener
        .local_addr()
        .map_err(|err| format!("local address failed: {err}"))?;
    if !is_agent_bind_ip(addr.ip()) {
        return Err("refused a non-loopback bind".to_string());
    }

    let secret: Arc<str> = uuid::Uuid::new_v4().simple().to_string().into();
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir failed: {err}"))?;
    write_bridge_file(&dir, addr.port(), &secret)
        .map_err(|err| format!("failed to write bridge file: {err}"))?;

    let pending = Arc::new(Mutex::new(HashMap::new()));
    let listen_pending = pending.clone();
    app.listen("agent-response", move |event| {
        if let Some(value) = parse_event_payload(event.payload()) {
            deliver(&listen_pending, value);
        }
    });

    let handler_app = app.clone();
    let handler: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(move |body| {
        prepare_open(&handler_app, &body);
        if handler_app.emit_to("main", "agent-request", &body).is_err() {
            log::error!("agent bridge: emit failed");
        }
    });

    let shared = Shared {
        secret,
        timeout: REQUEST_TIMEOUT,
        pending,
        handler,
    };
    serve(listener, shared)
        .await
        .map_err(|err| format!("serve failed: {err}"))
}

fn parse_event_payload(payload: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(payload).ok()? {
        Value::String(text) => serde_json::from_str(&text).ok(),
        value => Some(value),
    }
}

/// Grant the same file scope the single-instance handoff grants, and only for
/// an absolute path that exists. A directory is granted so the webview can
/// tell it is not a file; a missing path is not granted.
fn prepare_open(app: &AppHandle, body: &Value) {
    if body.get("cmd").and_then(Value::as_str) != Some("open") {
        return;
    }
    let Some(raw) = body.get("path").and_then(Value::as_str) else {
        return;
    };
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return;
    }
    if path.is_file() {
        crate::allow_file_in_scopes(app, vec![path]);
    } else if path.is_dir() {
        crate::allow_dir_in_scopes(app, &path);
    }
}

fn write_bridge_file(dir: &Path, port: u16, secret: &str) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(BRIDGE_FILE);
    let bytes = serde_json::to_vec(&json!({ "port": port, "secret": secret }))
        .map_err(|err| io::Error::other(err))?;
    write_private(&path, &bytes)?;
    Ok(())
}

#[cfg(test)]
fn read_bridge_file(dir: &Path) -> io::Result<(u16, String)> {
    let text = fs::read_to_string(dir.join(BRIDGE_FILE))?;
    let value: Value = serde_json::from_str(&text).map_err(|err| io::Error::other(err))?;
    let port = value
        .get("port")
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
        .ok_or_else(|| io::Error::other("bridge file has no port"))?;
    let secret = value
        .get("secret")
        .and_then(Value::as_str)
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| io::Error::other("bridge file has no secret"))?
        .to_string();
    Ok((port, secret))
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    fs::write(path, bytes)?;
    if let Err(err) = restrict_to_current_user(path) {
        log::warn!("agent bridge: could not restrict bridge file permissions: {err}");
    }
    Ok(())
}

#[cfg(windows)]
fn restrict_to_current_user(path: &Path) -> io::Result<()> {
    let user = std::env::var("USERNAME").map_err(io::Error::other)?;
    let status = std::process::Command::new("icacls")
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{user}:(R,W)"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("icacls failed"))
    }
}

async fn serve(listener: TcpListener, shared: Shared) -> io::Result<()> {
    loop {
        let (stream, peer) = listener.accept().await?;
        if !is_agent_bind_ip(peer.ip()) {
            continue;
        }
        let shared = shared.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req| {
                let shared = shared.clone();
                async move { Ok::<_, Infallible>(dispatch_http(req, shared).await) }
            });
            let connection = http1::Builder::new()
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service);
            if connection.await.is_err() {
                log::debug!("agent bridge: connection closed");
            }
        });
    }
}

async fn dispatch_http(req: Request<Incoming>, shared: Shared) -> Response<Full<Bytes>> {
    if req.method() != Method::POST || req.uri().path() != "/agent" {
        return empty(StatusCode::NOT_FOUND);
    }
    if !authorized(req.headers().get(AUTHORIZATION), &shared.secret) {
        return empty(StatusCode::UNAUTHORIZED);
    }

    let bytes = match http_body_util::Limited::new(req.into_body(), MAX_BODY)
        .collect()
        .await
    {
        Ok(collected) => collected.to_bytes(),
        Err(_) => return json_body(bad_request()),
    };
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(Value::Object(map)) => Value::Object(map),
        _ => return json_body(bad_request()),
    };
    let Some(id) = non_empty_str(value.get("id")) else {
        return json_body(bad_request());
    };
    if non_empty_str(value.get("cmd")).is_none() {
        return json_body(bad_request());
    }

    let (tx, rx) = oneshot::channel();
    {
        let mut pending = shared.pending.lock().unwrap_or_else(|err| err.into_inner());
        pending.insert(id.clone(), tx);
    }
    (shared.handler)(value);

    let response = match tokio::time::timeout(shared.timeout, rx).await {
        Ok(Ok(value)) => value,
        _ => {
            let mut pending = shared.pending.lock().unwrap_or_else(|err| err.into_inner());
            pending.remove(&id);
            json!({ "ok": false, "error": "timeout", "id": id })
        }
    };
    json_body(response)
}

fn deliver(pending: &Mutex<Pending>, value: Value) {
    let Some(id) = non_empty_str(value.get("id")) else {
        return;
    };
    let sender = {
        let mut pending = pending.lock().unwrap_or_else(|err| err.into_inner());
        pending.remove(&id)
    };
    if let Some(sender) = sender {
        let _ = sender.send(value);
    }
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn authorized(header: Option<&hyper::header::HeaderValue>, secret: &str) -> bool {
    let Some(header) = header.and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Some(token) = header.strip_prefix("Bearer ") else {
        return false;
    };
    secrets_match(token, secret)
}

fn secrets_match(provided: &str, secret: &str) -> bool {
    let provided = provided.as_bytes();
    let secret = secret.as_bytes();
    if provided.len() != secret.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in provided.iter().zip(secret.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

fn bad_request() -> Value {
    json!({ "ok": false, "error": "bad-request" })
}

fn json_body(value: Value) -> Response<Full<Bytes>> {
    let bytes = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(StatusCode::OK)
        .header(hyper::header::CONTENT_TYPE, "application/json")
        .header(hyper::header::CONTENT_LENGTH, bytes.len())
        .header(hyper::header::CONNECTION, "close")
        .body(Full::new(Bytes::from(bytes)))
        .unwrap()
}

fn empty(status: StatusCode) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header(hyper::header::CONTENT_LENGTH, "0")
        .header(hyper::header::CONNECTION, "close")
        .body(Full::new(Bytes::new()))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .enable_time()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    struct Running {
        addr: SocketAddr,
        secret: String,
    }

    async fn spawn(
        timeout: Duration,
        on_request: impl Fn(Value, &Responder) + Send + Sync + 'static,
    ) -> Running {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(
            is_agent_bind_ip(addr.ip()),
            "listener must bind 127.0.0.1, got {addr}"
        );
        let secret: Arc<str> = Arc::from("test-secret");
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let responder = Responder {
            pending: pending.clone(),
        };
        let handler: Arc<dyn Fn(Value) + Send + Sync> =
            Arc::new(move |body| on_request(body, &responder));
        let shared = Shared {
            secret: secret.clone(),
            timeout,
            pending,
            handler,
        };
        tokio::spawn(async move {
            let _ = serve(listener, shared).await;
        });
        Running {
            addr,
            secret: secret.to_string(),
        }
    }

    async fn exchange(
        addr: SocketAddr,
        method: &str,
        path: &str,
        bearer: Option<&str>,
        body: &str,
    ) -> (u16, Vec<u8>) {
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let auth = match bearer {
            Some(token) => format!("Authorization: Bearer {token}\r\n"),
            None => String::new(),
        };
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut raw = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut raw))
            .await
            .expect("client timed out")
            .unwrap();
        parse_response(&raw)
    }

    fn parse_response(raw: &[u8]) -> (u16, Vec<u8>) {
        let text = String::from_utf8_lossy(raw);
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_ref(), ""));
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        (status, body.as_bytes().to_vec())
    }

    fn echo(_body: Value, submit: &Responder) {
        // Replaced per test. This default is unused.
        let _ = submit;
    }

    #[test]
    fn listener_accepts_only_loopback() {
        assert!(is_agent_bind_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(!is_agent_bind_ip(IpAddr::V4(Ipv4Addr::UNSPECIFIED)));
        assert!(!is_agent_bind_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2))));
        assert!(!is_agent_bind_ip(IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)));

        block_on(async {
            let running = spawn(Duration::from_millis(200), echo).await;
            assert_eq!(running.addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        });
    }

    #[test]
    fn post_with_bearer_returns_handler_json() {
        block_on(async {
            let running = spawn(Duration::from_secs(2), |body, submit| {
                let id = body["id"].as_str().unwrap().to_string();
                submit.send(json!({ "ok": true, "id": id, "running": true }));
            })
            .await;
            let (status, body) = exchange(
                running.addr,
                "POST",
                "/agent",
                Some(&running.secret),
                r#"{"id":"req-7","cmd":"status"}"#,
            )
            .await;
            assert_eq!(status, 200);
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["ok"], true);
            assert_eq!(value["id"], "req-7");
            assert_eq!(value["running"], true);
        });
    }

    #[test]
    fn rejected_requests_skip_the_handler_and_have_an_empty_body() {
        block_on(async {
            let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let calls_handler = calls.clone();
            let running = spawn(Duration::from_millis(200), move |_body, _submit| {
                calls_handler.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
            .await;
            let secret = running.secret.clone();
            let cases = [
                ("POST", "/agent", None, r#"{"id":"1","cmd":"status"}"#),
                (
                    "POST",
                    "/agent",
                    Some("nope"),
                    r#"{"id":"1","cmd":"status"}"#,
                ),
                ("GET", "/agent", Some(secret.as_str()), ""),
                (
                    "POST",
                    "/other",
                    Some(secret.as_str()),
                    r#"{"id":"1","cmd":"status"}"#,
                ),
            ];
            for (method, path, bearer, payload) in cases {
                let (status, body) = exchange(running.addr, method, path, bearer, payload).await;
                assert!(
                    status == 401 || status == 404,
                    "{method} {path} -> {status}"
                );
                assert!(body.is_empty(), "{method} {path} body {body:?}");
            }
            assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        });
    }

    #[test]
    fn malformed_json_and_missing_fields_are_bad_request() {
        block_on(async {
            let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let calls_handler = calls.clone();
            let running = spawn(Duration::from_millis(200), move |_body, _submit| {
                calls_handler.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
            .await;
            for payload in [r#"{"id":"#, r#"{"cmd":"status"}"#, r#"{"id":"1"}"#, "null"] {
                let (status, body) = exchange(
                    running.addr,
                    "POST",
                    "/agent",
                    Some(&running.secret),
                    payload,
                )
                .await;
                assert_eq!(status, 200, "{payload}");
                let value: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(value, json!({ "ok": false, "error": "bad-request" }));
            }
            assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        });
    }

    #[test]
    fn response_id_is_the_request_id() {
        block_on(async {
            let running = spawn(Duration::from_secs(2), |body, submit| {
                submit.send(json!({
                    "ok": true,
                    "id": body["id"].as_str().unwrap(),
                }));
            })
            .await;
            let (_status, body) = exchange(
                running.addr,
                "POST",
                "/agent",
                Some(&running.secret),
                r#"{"id":"abc","cmd":"context"}"#,
            )
            .await;
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["id"], "abc");
        });
    }

    #[test]
    fn silent_handler_times_out() {
        block_on(async {
            let running = spawn(Duration::from_millis(80), |_body, _submit| {}).await;
            let started = std::time::Instant::now();
            let (status, body) = exchange(
                running.addr,
                "POST",
                "/agent",
                Some(&running.secret),
                r#"{"id":"1","cmd":"status"}"#,
            )
            .await;
            assert!(started.elapsed() < Duration::from_secs(2));
            assert_eq!(status, 200);
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["ok"], false);
            assert_eq!(value["error"], "timeout");
        });
    }

    #[test]
    fn mismatched_response_id_is_ignored_and_times_out() {
        block_on(async {
            let running = spawn(Duration::from_millis(80), |_body, submit| {
                submit.send(json!({ "ok": true, "id": "other" }));
            })
            .await;
            let (status, body) = exchange(
                running.addr,
                "POST",
                "/agent",
                Some(&running.secret),
                r#"{"id":"1","cmd":"status"}"#,
            )
            .await;
            assert_eq!(status, 200);
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["error"], "timeout");
            assert_eq!(value["id"], "1");
        });
    }

    #[test]
    fn secret_file_round_trips_and_a_second_start_overwrites_it() {
        let dir = std::env::temp_dir().join(format!(
            "readest-agent-bridge-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        let _ = fs::remove_dir_all(&dir);
        write_bridge_file(&dir, 43111, "alpha").unwrap();
        assert_eq!(
            read_bridge_file(&dir).unwrap(),
            (43111, "alpha".to_string())
        );
        write_bridge_file(&dir, 43112, "beta").unwrap();
        assert_eq!(read_bridge_file(&dir).unwrap(), (43112, "beta".to_string()));
        let text = fs::read_to_string(dir.join(BRIDGE_FILE)).unwrap();
        assert!(!text.contains("alpha"));
        let _ = fs::remove_dir_all(&dir);
    }
}
