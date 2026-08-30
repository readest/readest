//! The axum router + handlers backing the LAN sync server. Endpoint semantics
//! map 1:1 onto the `FileSyncProvider` methods in
//! `services/sync/file/provider.ts`:
//!
//!   GET  /ping            → pairing probe (LanForm "test connection")
//!   GET  /files/{path}    → readText / readBinary (404 = absent)
//!   HEAD /files/{path}    → head (Content-Length + ETag for the short-circuit)
//!   PUT  /files/{path}    → writeText / writeBinary (parent dirs auto-created)
//!   DEL  /files/{path}    → deleteDir (recursive; missing = success)
//!   POST /list {dir}      → list (immediate children, engine-style entries)
//!
//! Book files are buffered in memory today; the M2 streaming endpoints will
//! move large EPUBs to chunked transfer without changing these shapes.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

/// Upper bound for one request body (book binaries ride PUTs). Axum's default
/// is 2 MiB, which silently 413-rejects nearly every real book; 2 GiB leaves
/// room for the largest comics/PDFs while still bounding a malicious peer.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024 * 1024;

pub struct ServerState {
    /// On-disk root of the remote-format tree (`.../LanSync/`).
    pub root: PathBuf,
    /// Optional shared pairing token. `None` permits direct LAN access.
    pub auth_token: Option<String>,
    pub device_name: String,
    pub device_id: String,
}

pub fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/ping", get(ping))
        .route(
            "/files/{*path}",
            get(read_file).head(head_file).put(write_file).delete(delete_path),
        )
        .route("/list", post(list_dir))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_and_cors,
        ))
        .with_state(state)
}

/// Bearer-token gate + permissive CORS (the peer is a webview page on
/// `tauri://localhost`-ish origins, so preflights must be answered and every
/// response must be readable cross-origin).
async fn auth_and_cors(
    State(state): State<Arc<ServerState>>,
    req: Request,
    next: Next,
) -> Response {
    if req.method() == Method::OPTIONS {
        return with_cors(StatusCode::NO_CONTENT.into_response());
    }
    let authorized = match state.auth_token.as_deref() {
        None => true,
        Some(token) => {
            let expected = format!("Bearer {token}");
            req.headers()
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v == expected)
        }
    };
    if !authorized {
        return with_cors((StatusCode::UNAUTHORIZED, "unauthorized").into_response());
    }
    with_cors(next.run(req).await)
}

fn with_cors(mut res: Response) -> Response {
    let headers = res.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, PUT, DELETE, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Authorization, Content-Type"),
    );
    headers.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400"));
    res
}

/// Join a request path onto the root, refusing anything that could escape it.
/// `..` is rejected outright; so are `\` (a path separator on Windows that
/// would smuggle extra segments), NUL, and `:` (illegal in Windows filenames,
/// therefore never present in the frozen layout).
fn safe_join(root: &std::path::Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() {
        return None;
    }
    let mut out = root.to_path_buf();
    for segment in rel.split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            s => {
                if s.contains('\\') || s.contains('\0') || s.contains(':') {
                    return None;
                }
                out.push(s);
            }
        }
    }
    if out.starts_with(root) {
        Some(out)
    } else {
        None
    }
}

/// Resolve the root and reject symlinks in every existing requested component.
/// Missing components are allowed so writes can create them safely afterward.
async fn checked_join(root: &std::path::Path, rel: &str) -> std::io::Result<Option<PathBuf>> {
    let Some(joined) = safe_join(root, rel) else {
        return Ok(None);
    };
    let canonical_root = tokio::fs::canonicalize(root).await?;
    let relative = joined
        .strip_prefix(root)
        .expect("safe_join result must be under root");
    let mut checked = canonical_root.clone();
    for component in relative.components() {
        checked.push(component.as_os_str());
        match tokio::fs::symlink_metadata(&checked).await {
            Ok(meta) if meta.file_type().is_symlink() => return Ok(None),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(e),
        }
    }
    Ok(Some(checked))
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "not found").into_response()
}

fn bad_request(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, msg.to_string()).into_response()
}

fn internal_error(err: std::io::Error) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
}

fn etag_for(meta: &std::fs::Metadata) -> String {
    let size = meta.len();
    let secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("\"{size:x}-{secs:x}\"")
}

async fn ping(State(state): State<Arc<ServerState>>) -> Response {
    with_cors(
        Json(json!({
            "name": state.device_name,
            "device_id": state.device_id,
            "protocol": "readest-lan-sync-1",
        }))
        .into_response(),
    )
}

async fn read_file(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full = match checked_join(&state.root, &path).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    match tokio::fs::metadata(&full).await {
        Ok(meta) if meta.is_file() => match tokio::fs::read(&full).await {
            Ok(bytes) => with_cors((
                [(header::CONTENT_TYPE, "application/octet-stream")],
                bytes,
            )
                .into_response()),
            Err(e) => internal_error(e),
        },
        Ok(_) => not_found(),
        Err(_) => not_found(),
    }
}

async fn head_file(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full = match checked_join(&state.root, &path).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    match tokio::fs::metadata(&full).await {
        Ok(meta) if meta.is_file() => {
            let size = meta.len();
            let etag = etag_for(&meta);
            with_cors(
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_LENGTH, size)
                    .header(header::CONTENT_TYPE, "application/octet-stream")
                    .header(header::ETAG, etag)
                    .body(Body::empty())
                    .expect("static head response"),
            )
        }
        Ok(_) => not_found(),
        Err(_) => not_found(),
    }
}

async fn write_file(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
    body: Bytes,
) -> Response {
    let full = match checked_join(&state.root, &path).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    // checked_join validates existing parents before creating missing ones.
    if let Some(parent) = full.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return internal_error(e);
        }
    }
    match tokio::fs::write(&full, body).await {
        Ok(()) => with_cors(StatusCode::NO_CONTENT.into_response()),
        Err(e) => internal_error(e),
    }
}

async fn delete_path(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full = match checked_join(&state.root, &path).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    let canonical_root = match tokio::fs::canonicalize(&state.root).await {
        Ok(root) => root,
        Err(e) => return internal_error(e),
    };
    if full == canonical_root {
        return bad_request("cannot delete LAN sync root");
    }
    // Missing is success: deleteDir's contract is idempotence.
    let result = match tokio::fs::metadata(&full).await {
        Ok(meta) if meta.is_dir() => tokio::fs::remove_dir_all(&full).await,
        Ok(_) => tokio::fs::remove_file(&full).await,
        Err(_) => Ok(()),
    };
    match result {
        Ok(()) => with_cors(StatusCode::NO_CONTENT.into_response()),
        Err(e) => internal_error(e),
    }
}

#[derive(Deserialize)]
struct ListRequest {
    dir: String,
}

async fn list_dir(
    State(state): State<Arc<ServerState>>,
    Json(req): Json<ListRequest>,
) -> Response {
    let dir = if req.dir.starts_with('/') {
        req.dir
    } else {
        format!("/{}", req.dir)
    };
    let full = match checked_join(&state.root, &dir).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    let mut entries = Vec::new();
    let mut reader = match tokio::fs::read_dir(&full).await {
        Ok(reader) => reader,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return with_cors(Json(json!({ "entries": entries })).into_response());
        }
        Err(e) => return internal_error(e),
    };
    while let Ok(Some(entry)) = reader.next_entry().await {
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let child_path = format!("{}/{}", dir.trim_end_matches('/'), name);
        let (is_dir, size) = if meta.is_dir() {
            (true, None)
        } else {
            (false, Some(meta.len()))
        };
        entries.push(json!({
            "name": name,
            "path": child_path,
            "isDirectory": is_dir,
            "size": size,
        }));
    }
    with_cors(Json(json!({ "entries": entries })).into_response())
}
