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
//! Book uploads and downloads are streamed from disk; native clients can use
//! the same endpoints without buffering whole books in the webview.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

/// Upper bound for one request body (book binaries ride PUTs). Axum's default
/// is 2 MiB, which silently 413-rejects nearly every real book; 2 GiB leaves
/// room for the largest comics/PDFs while still bounding a malicious peer.
const MAX_BODY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub struct ServerState {
    /// On-disk root of the remote-format tree (`.../LanSync/`).
    pub root: PathBuf,
    /// Optional shared pairing token. `None` permits direct LAN access.
    pub auth_token: Option<String>,
    pub device_name: String,
    pub device_id: String,
}

fn is_authorized(headers: &HeaderMap, auth_token: Option<&str>) -> bool {
    match auth_token {
        None => true,
        Some(token) => {
            let expected = format!("Bearer {token}");
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value == expected)
        }
    }
}

pub fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/ping", get(ping))
        .route(
            "/files/{*path}",
            get(read_file).head(head_file).put(write_file).delete(delete_path),
        )
        .route(
            "/list",
            post(list_dir).layer(DefaultBodyLimit::max(64 * 1024)),
        )
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
    let authorized = is_authorized(req.headers(), state.auth_token.as_deref());
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
        HeaderValue::from_static("Authorization, Content-Type, Range, If-Range"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag"),
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
///
/// Once the first missing component is reached we still append the remaining
/// lexical suffix. The old implementation stopped there, so the first PUT for
/// `Readest/books/<hash>/config.json` resolved to `Readest/books/<hash>` and
/// wrote the JSON body into a FILE named `<hash>`. Existing hash directories
/// kept working while every newly imported book failed its later config/file
/// uploads — exactly the "old 18 sync, new books never appear" failure mode.
async fn checked_join(root: &std::path::Path, rel: &str) -> std::io::Result<Option<PathBuf>> {
    let Some(joined) = safe_join(root, rel) else {
        return Ok(None);
    };
    let canonical_root = tokio::fs::canonicalize(root).await?;
    let relative = joined
        .strip_prefix(root)
        .expect("safe_join result must be under root");
    let components: Vec<_> = relative.components().collect();
    let mut checked = canonical_root.clone();
    let mut missing = false;
    for (index, component) in components.iter().enumerate() {
        checked.push(component.as_os_str());
        if missing {
            continue;
        }
        match tokio::fs::symlink_metadata(&checked).await {
            Ok(meta) if meta.file_type().is_symlink() => return Ok(None),
            Ok(meta) => {
                if index + 1 < components.len() && !meta.is_dir() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotADirectory,
                        format!("LAN sync path component is not a directory: {}", checked.display()),
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => missing = true,
            Err(e) => return Err(e),
        }
    }
    Ok(Some(checked))
}

/// Repair the exact directory slots the old checked_join bug could have
/// published as files. This is intentionally limited to Readest's frozen wire
/// layout rather than deleting arbitrary regular-file ancestors supplied by a
/// peer. It makes already-poisoned phones self-heal on the next PUT, so users do
/// not need to clear LAN Sync storage or re-import their books.
async fn repair_legacy_wire_dirs(root: &Path, rel: &str) -> std::io::Result<()> {
    let segments: Vec<&str> = rel.split('/').filter(|segment| !segment.is_empty()).collect();
    if segments.first().copied() != Some("Readest") {
        return Ok(());
    }

    let mut directory_depths = vec![1usize]; // Readest
    if segments.get(1).copied() == Some("books") {
        directory_depths.push(2); // Readest/books
        if segments.len() >= 4 {
            directory_depths.push(3); // Readest/books/<hash>
        }
        if segments.get(3).copied() == Some("tts") && segments.len() >= 5 {
            directory_depths.push(4); // Readest/books/<hash>/tts
        }
    } else if segments.get(1).copied() == Some("stats") && segments.len() >= 3 {
        directory_depths.push(2); // Readest/stats
    }

    for depth in directory_depths {
        let mut candidate = root.to_path_buf();
        for segment in segments.iter().take(depth) {
            candidate.push(segment);
        }
        match tokio::fs::symlink_metadata(&candidate).await {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("refusing symlink in LAN sync path: {}", candidate.display()),
                ));
            }
            Ok(meta) if !meta.is_dir() => {
                tokio::fs::remove_file(&candidate).await?;
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
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

async fn publish_part_file(part_path: &Path, file_path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        crate::transfer_file::replace_file_atomically(part_path, file_path)
    }

    #[cfg(not(windows))]
    {
        tokio::fs::rename(part_path, file_path).await
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

impl ByteRange {
    const fn new(start: u64, end: u64) -> Self {
        Self { start, end }
    }

    const fn len(&self) -> u64 {
        self.end - self.start + 1
    }
}

fn parse_byte_range(value: &str, size: u64) -> Result<ByteRange, ()> {
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') || size == 0 {
        return Err(());
    }
    let (start, end) = spec.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok(ByteRange::new(size.saturating_sub(suffix), size - 1));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if start > end {
        return Err(());
    }
    Ok(ByteRange::new(start, end))
}

fn etag_for(meta: &std::fs::Metadata) -> String {
    let size = meta.len();
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("\"{size:x}-{modified:x}\"")
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

fn range_for(headers: &HeaderMap, size: u64, etag: &str) -> Result<Option<ByteRange>, ()> {
    let Some(range) = headers.get(header::RANGE).and_then(|value| value.to_str().ok()) else {
        return Ok(None);
    };
    if headers
        .get(header::IF_RANGE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|if_range| if_range != etag)
    {
        return Ok(None);
    }
    parse_byte_range(range, size).map(Some)
}

fn range_error(size: u64) -> Response {
    with_cors(
        Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Body::empty())
            .expect("static range response"),
    )
}

fn response_headers(
    status: StatusCode,
    size: u64,
    etag: String,
    range: Option<&ByteRange>,
) -> axum::http::response::Builder {
    let (content_length, content_range) = match range {
        Some(range) => (
            range.len(),
            Some(format!("bytes {}-{}/{}", range.start, range.end, size)),
        ),
        None => (size, None),
    };
    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ETAG, etag);
    if let Some(content_range) = content_range {
        builder = builder.header(header::CONTENT_RANGE, content_range);
    }
    builder
}

async fn read_file(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let full = match checked_join(&state.root, &path).await {
        Ok(Some(full)) => full,
        Ok(None) => return bad_request("invalid path"),
        Err(e) => return internal_error(e),
    };
    let mut file = match tokio::fs::File::open(&full).await {
        Ok(file) => file,
        Err(_) => return not_found(),
    };
    let meta = match file.metadata().await {
        Ok(meta) if meta.is_file() => meta,
        _ => return not_found(),
    };
    let size = meta.len();
    let etag = etag_for(&meta);
    let range = match range_for(&headers, size, &etag) {
        Ok(range) => range,
        Err(()) => return range_error(size),
    };
    if let Some(range) = &range {
        if let Err(e) = file.seek(std::io::SeekFrom::Start(range.start)).await {
            return internal_error(e);
        }
        let stream = ReaderStream::with_capacity(file.take(range.len()), 64 * 1024);
        return with_cors(
            response_headers(StatusCode::PARTIAL_CONTENT, size, etag, Some(range))
                .body(Body::from_stream(stream))
                .expect("static range response"),
        );
    }
    let stream = ReaderStream::with_capacity(file, 64 * 1024);
    with_cors(
        response_headers(StatusCode::OK, size, etag, None)
            .body(Body::from_stream(stream))
            .expect("static read response"),
    )
}

async fn head_file(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
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
            let range = match range_for(&headers, size, &etag) {
                Ok(range) => range,
                Err(()) => return range_error(size),
            };
            let status = if range.is_some() {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            };
            with_cors(
                response_headers(status, size, etag, range.as_ref())
                    .body(Body::empty())
                    .expect("static head response"),
            )
        }
        Ok(_) => not_found(),
        Err(_) => not_found(),
    }
}

/// Best-effort removal of a `.part` temp file when a streaming write is
/// abandoned (handler error, or the future dropped mid-transfer because the
/// peer disconnected — Drop can't await, so the cleanup is spawned).
struct PartFileGuard {
    path: PathBuf,
    armed: bool,
}

impl PartFileGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PartFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let path = self.path.clone();
            tokio::spawn(async move {
                let _ = tokio::fs::remove_file(&path).await;
            });
        }
    }
}

async fn write_file(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
    body: Body,
) -> Response {
    // Heal regular files left in frozen directory positions by the old
    // checked_join truncation bug before validating/creating the full path.
    if let Err(e) = repair_legacy_wire_dirs(&state.root, &path).await {
        return internal_error(e);
    }
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
        return bad_request("cannot write LAN sync root");
    }
    // checked_join validates existing parents before creating missing ones.
    if let Some(parent) = full.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return internal_error(e);
        }
    }
    // Stream the request body to a short, same-directory `.part` temp file and
    // rename atomically on completion. Do NOT append the UUID to the target
    // filename: makeSafeFilename can already use nearly the filesystem's full
    // 255-byte component budget, and `<long-name>.epub.<uuid>.part` exceeded it
    // on Android/Linux. The hash directory already isolates each book and the
    // UUID makes concurrent temp names unique.
    let Some(parent) = full.parent() else {
        return bad_request("invalid file path");
    };
    let part_path = parent.join(format!(".upload-{}.part", uuid::Uuid::new_v4().simple()));

    let file = match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part_path)
        .await
    {
        Ok(file) => file,
        Err(e) => return internal_error(e),
    };
    let mut guard = PartFileGuard {
        path: part_path.clone(),
        armed: true,
    };
    let mut writer = tokio::io::BufWriter::new(file);
    let mut stream = body.into_data_stream();
    let mut written = 0u64;
    // BodyDataStream yields the body as `Bytes` chunks directly. Because this
    // handler consumes the raw Body, enforce the limit here as well as through
    // DefaultBodyLimit (which primarily protects extractor-based handlers).
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(_) => {
                // Peer disconnected mid-upload; the guard removes the temp file.
                return with_cors(internal_error(std::io::Error::new(
                    std::io::ErrorKind::ConnectionAborted,
                    "peer disconnected mid-upload",
                )));
            }
        };
        let next_size = written.saturating_add(chunk.len() as u64);
        if next_size > MAX_BODY_BYTES {
            return with_cors(
                (StatusCode::PAYLOAD_TOO_LARGE, "request body too large").into_response(),
            );
        }
        written = next_size;
        if let Err(e) = writer.write_all(&chunk).await {
            return internal_error(e);
        }
    }
    if let Err(e) = writer.flush().await {
        return internal_error(e);
    }
    drop(writer); // release the handle before renaming (Windows)
    match publish_part_file(&part_path, &full).await {
        Ok(()) => {
            guard.disarm();
            with_cors(StatusCode::NO_CONTENT.into_response())
        }
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
        if name.ends_with(".part") || name.ends_with(".previous") {
            continue;
        }
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

#[cfg(test)]
mod tests {
    use super::{checked_join, is_authorized, parse_byte_range, repair_legacy_wire_dirs, ByteRange};
    use axum::http::{header, HeaderMap, HeaderValue};

    #[test]
    fn parses_supported_byte_ranges() {
        assert_eq!(parse_byte_range("bytes=0-99", 200), Ok(ByteRange::new(0, 99)));
        assert_eq!(parse_byte_range("bytes=100-", 200), Ok(ByteRange::new(100, 199)));
        assert_eq!(parse_byte_range("bytes=-25", 200), Ok(ByteRange::new(175, 199)));
    }

    #[test]
    fn rejects_malformed_multiple_and_unsatisfiable_ranges() {
        for value in ["bytes=", "items=0-1", "bytes=0-1,2-3", "bytes=200-", "bytes=-0"] {
            assert!(parse_byte_range(value, 200).is_err(), "{value}");
        }
        assert!(parse_byte_range("bytes=0-1", 0).is_err());
    }

    #[test]
    fn anonymous_server_accepts_requests_without_authorization() {
        assert!(is_authorized(&HeaderMap::new(), None));
    }

    #[test]
    fn protected_server_requires_the_exact_bearer_token() {
        let mut headers = HeaderMap::new();
        assert!(!is_authorized(&headers, Some("secret")));

        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer wrong"));
        assert!(!is_authorized(&headers, Some("secret")));

        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer secret"),
        );
        assert!(is_authorized(&headers, Some("secret")));
    }

    #[tokio::test]
    async fn checked_join_keeps_suffix_after_first_missing_component() {
        let root = std::env::temp_dir().join(format!("readest-lan-path-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let resolved = checked_join(&root, "/Readest/books/hash/config.json")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(resolved, root.join("Readest/books/hash/config.json"));
        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn repairs_hash_file_left_by_old_truncation_bug() {
        let root = std::env::temp_dir().join(format!("readest-lan-repair-{}", uuid::Uuid::new_v4()));
        let books = root.join("Readest/books");
        tokio::fs::create_dir_all(&books).await.unwrap();
        let poisoned = books.join("hash");
        tokio::fs::write(&poisoned, b"old config body").await.unwrap();

        repair_legacy_wire_dirs(&root, "/Readest/books/hash/config.json")
            .await
            .unwrap();
        assert!(tokio::fs::metadata(&poisoned).await.is_err());
        let resolved = checked_join(&root, "/Readest/books/hash/config.json")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(resolved, root.join("Readest/books/hash/config.json"));
        let _ = tokio::fs::remove_dir_all(&root).await;
    }
}
