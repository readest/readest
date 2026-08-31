// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Upload files from disk to a remote server over HTTP.
//!
//! Download files from a remote HTTP server to disk.

use futures_util::TryStreamExt;
use serde::{ser::Serializer, Serialize};
use tauri::{command, ipc::Channel, AppHandle};
use tauri_plugin_fs::FsExt;
use tokio::{
    fs::{File, OpenOptions},
    io::{AsyncWriteExt, BufWriter},
};
use tokio_util::codec::{BytesCodec, FramedRead};

use read_progress_stream::ReadProgressStream;

use std::time::Instant;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

type Result<T> = std::result::Result<T, Error>;

const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES: u64 = 64 * 1024;

// The TransferStats struct tracks both transfer speed and cumulative transfer progress.
pub struct TransferStats {
    accumulated_chunk_len: usize, // Total length of chunks transferred in the current period
    accumulated_time: u128,       // Total time taken for the transfers in the current period
    pub transfer_speed: u64,      // Calculated transfer speed in bytes per second
    pub total_transferred: u64,   // Cumulative total of all transferred data
    start_time: Instant,          // Time when the current period started
    granularity: u32, // Time period (in milliseconds) over which the transfer speed is calculated
}

impl TransferStats {
    // Initializes a new TransferStats instance with the specified granularity.
    pub fn start(granularity: u32) -> Self {
        Self {
            accumulated_chunk_len: 0,
            accumulated_time: 0,
            transfer_speed: 0,
            total_transferred: 0,
            start_time: Instant::now(),
            granularity,
        }
    }
    // Records the transfer of a data chunk and updates both transfer speed and total progress.
    pub fn record_chunk_transfer(&mut self, chunk_len: usize) {
        let now = Instant::now();
        let it_took = now.duration_since(self.start_time).as_millis();
        self.accumulated_chunk_len += chunk_len;
        self.total_transferred += chunk_len as u64;
        self.accumulated_time += it_took;

        // Calculate transfer speed if accumulated time exceeds granularity.
        if self.accumulated_time >= self.granularity as u128 {
            self.transfer_speed =
                (self.accumulated_chunk_len as u128 / self.accumulated_time * 1024) as u64;
            self.accumulated_chunk_len = 0;
            self.accumulated_time = 0;
        }

        // Reset the start time for the next period.
        self.start_time = now;
    }
}

// Provides a default implementation for TransferStats with a granularity of 500 milliseconds.
impl Default for TransferStats {
    fn default() -> Self {
        Self::start(500) // Default granularity is 500 ms
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error("{0}")]
    ContentLength(String),
    #[error("request failed with status code {0}: {1}")]
    HttpErrorCode(u16, String),
    #[error("permission denied: path not in filesystem scope: {0}")]
    Forbidden(String),
}

struct DownloadTempFile {
    path: String,
    committed: bool,
}

impl DownloadTempFile {
    fn new(file_path: &str) -> Self {
        Self {
            path: format!("{file_path}.{}.part", uuid::Uuid::new_v4().simple()),
            committed: false,
        }
    }
}

impl Drop for DownloadTempFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(windows)]
pub(crate) fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let to_wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    };
    let source = to_wide(source);
    let destination = to_wide(destination);

    // ReplaceFileW publishes over an existing destination without the delete-
    // then-rename gap of std::fs::rename on Windows.
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            source.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced != 0 {
        return Ok(());
    }

    // The first download has no destination yet. MoveFileExW is atomic on the
    // same volume and also handles a destination created in the small race.
    let error = std::io::Error::last_os_error();
    if error.kind() != std::io::ErrorKind::NotFound {
        return Err(error);
    }
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

async fn commit_download_file(temp: &mut DownloadTempFile, file_path: &str) -> Result<()> {
    #[cfg(windows)]
    {
        replace_file_atomically(Path::new(&temp.path), Path::new(file_path))?;
        temp.committed = true;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        tokio::fs::rename(&temp.path, file_path).await?;
        temp.committed = true;
        Ok(())
    }
}

fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let (range, total) = value.trim().split_once('/')?;
    let mut parts = range.split_ascii_whitespace();
    if !parts.next().is_some_and(|unit| unit.eq_ignore_ascii_case("bytes")) {
        return None;
    }
    let byte_range = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let (start, end) = byte_range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.trim().parse().ok()?))
}

async fn read_response_body_limited(response: reqwest::Response, max_bytes: u64) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.try_next().await? {
        let next_len = (body.len() as u64).saturating_add(chunk.len() as u64);
        if next_len > max_bytes {
            return Err(Error::ContentLength(format!(
                "response body exceeds the {max_bytes}-byte limit"
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Reject paths the webview must not be allowed to target: relative paths and
/// any `..` parent-directory traversal. `fs_scope().is_allowed` is a glob match,
/// so a `..` segment could otherwise escape an allowed prefix.
fn has_disallowed_components(file_path: &str) -> bool {
    let path = std::path::Path::new(file_path);
    !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
}

/// Canonicalize a path even when its final components have not been created yet.
/// This also resolves symlinked parent directories before a download creates its
/// destination.
fn canonicalize_with_missing(path: &Path) -> Option<PathBuf> {
    let mut current = path.to_path_buf();
    let mut missing = Vec::new();
    loop {
        if let Ok(mut canonical) = std::fs::canonicalize(&current) {
            for component in missing.iter().rev() {
                canonical.push(component);
            }
            return Some(canonical);
        }
        let name = current.file_name()?.to_os_string();
        missing.push(name);
        if !current.pop() {
            return None;
        }
    }
}

fn is_path_within_root(root: &Path, path: &Path) -> bool {
    let Some(root) = canonicalize_with_missing(root) else {
        return false;
    };
    let Some(path) = canonicalize_with_missing(path) else {
        return false;
    };

    #[cfg(windows)]
    {
        let root = root
            .to_string_lossy()
            .trim_end_matches(&['\\', '/'][..])
            .to_ascii_lowercase();
        let path = path.to_string_lossy().to_ascii_lowercase();
        path == root || path.starts_with(&format!("{root}\\")) || path.starts_with(&format!("{root}/"))
    }
    #[cfg(not(windows))]
    {
        path == root || path.strip_prefix(root).is_ok()
    }
}

/// App data/cache/config paths are not always included in the global fs scope,
/// so retain a narrowly bounded fallback for files owned by this app. Portable
/// installs additionally use the executable directory when its Settings.json
/// marker is present. Canonicalization prevents symlink and prefix-bypass paths.
fn is_within_app_storage(app: &AppHandle, file_path: &str) -> bool {
    let path = Path::new(file_path);
    let mut roots = Vec::new();
    for root in [
        app.path().app_data_dir().ok(),
        app.path().app_cache_dir().ok(),
        app.path().app_config_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        roots.push(root);
    }

    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            // Native portable mode is identified by this marker (see the JS
            // path resolver), so an installed app never gets its install dir
            // implicitly added to the writable fallback.
            if parent.join("Settings.json").is_file() {
                roots.push(parent.to_path_buf());
            }
        }
    }

    roots.iter().any(|root| is_path_within_root(root, path))
}

/// Validate a webview-supplied `file_path` before any `File::create`/`File::open`.
/// Without this, `download_file`/`upload_file` would write/read arbitrary local
/// paths (e.g. `~/.ssh/id_rsa`, autostart entries) from any JS running in the
/// privileged Tauri origin — see GHSA-55vr-pvq5-6fmg. We require an absolute,
/// traversal-free path that is either granted by the fs scope (persisted dialog
/// grants for custom/external roots) or lives inside the app's own storage.
/// Scope checks use the canonical path too, so a symlink/reparse point cannot
/// turn an allowed lexical path into an outside target.
pub(crate) fn ensure_path_allowed(
    app: &AppHandle,
    file_path: &str,
) -> std::result::Result<(), Error> {
    if has_disallowed_components(file_path) {
        return Err(Error::Forbidden(file_path.to_string()));
    }
    let path = Path::new(file_path);
    let canonical = canonicalize_with_missing(path);
    let scope_allowed = canonical
        .as_ref()
        .is_some_and(|path| app.fs_scope().is_allowed(path));
    if scope_allowed || is_within_app_storage(app, file_path) {
        return Ok(());
    }
    Err(Error::Forbidden(file_path.to_string()))
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    progress: u64,
    total: u64,
    transfer_speed: u64,
}

#[command]
#[allow(clippy::too_many_arguments)] // Tauri command surface mirrors the JS caller's options.
pub async fn download_file(
    app: AppHandle,
    url: &str,
    file_path: &str,
    headers: HashMap<String, String>,
    body: Option<String>,
    single_threaded: Option<bool>,
    skip_ssl_verification: Option<bool>,
    on_progress: Channel<ProgressPayload>,
) -> Result<HashMap<String, String>> {
    use futures::stream::{self, StreamExt};
    use std::cmp::min;
    use tokio::io::AsyncSeekExt;

    ensure_path_allowed(&app, file_path)?;

    const PART_SIZE: u64 = 1024 * 1024;

    let client = reqwest::ClientBuilder::new()
        .danger_accept_invalid_certs(skip_ssl_verification.unwrap_or(false))
        .danger_accept_invalid_hostnames(skip_ssl_verification.unwrap_or(false))
        .build()?;
    let force_single = single_threaded.unwrap_or(false);

    async fn single_threaded_download(
        client: &reqwest::Client,
        url: &str,
        file_path: &str,
        headers: &HashMap<String, String>,
        body: &Option<String>,
        on_progress: Channel<ProgressPayload>,
    ) -> Result<HashMap<String, String>> {
        let mut request = if let Some(body) = body {
            client.post(url).body(body.clone())
        } else {
            client.get(url)
        };

        for (key, value) in headers {
            request = request.header(key, value);
        }

        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = read_response_body_limited(response, MAX_ERROR_BODY_BYTES).await?;
            return Err(Error::HttpErrorCode(
                status,
                String::from_utf8_lossy(&body).into_owned(),
            ));
        }

        let mut resp_headers = HashMap::new();
        for (key, value) in response.headers().iter() {
            if let Ok(val_str) = value.to_str() {
                resp_headers.insert(key.to_string(), val_str.to_string());
            }
        }

        let total = response.content_length().unwrap_or(0);
        if total > MAX_DOWNLOAD_BYTES {
            return Err(Error::ContentLength(format!(
                "download size {total} exceeds the {MAX_DOWNLOAD_BYTES}-byte limit"
            )));
        }
        let mut temp = DownloadTempFile::new(file_path);
        {
            let mut file = BufWriter::new(
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temp.path)
                    .await?,
            );
            let mut stream = response.bytes_stream();

            let mut received = 0u64;
            let mut stats = TransferStats::default();
            while let Some(chunk) = stream.try_next().await? {
                let next_received = received.saturating_add(chunk.len() as u64);
                if next_received > MAX_DOWNLOAD_BYTES {
                    return Err(Error::ContentLength(format!(
                        "response body exceeds the {MAX_DOWNLOAD_BYTES}-byte limit"
                    )));
                }
                received = next_received;
                file.write_all(&chunk).await?;
                stats.record_chunk_transfer(chunk.len());
                let _ = on_progress.send(ProgressPayload {
                    progress: stats.total_transferred,
                    total,
                    transfer_speed: stats.transfer_speed,
                });
            }
            file.flush().await?;
        }
        commit_download_file(&mut temp, file_path).await?;

        Ok(resp_headers)
    }

    if force_single {
        return single_threaded_download(&client, url, file_path, &headers, &body, on_progress)
            .await;
    }

    // Check if server supports range requests
    let mut range_req = client.get(url).header("Range", "bytes=0-0");
    for (key, value) in headers.iter() {
        range_req = range_req.header(key, value);
    }
    let range_resp = range_req.send().await?;
    let range_status = range_resp.status();
    let accept_ranges = range_resp
        .headers()
        .get("accept-ranges")
        .map(|v| v.to_str().unwrap_or(""))
        .unwrap_or("")
        .eq_ignore_ascii_case("bytes");
    let probe_range = range_resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_range);
    let total = probe_range.map(|(_, _, total)| total).unwrap_or(0);
    let probe_body_size_ok = range_resp.content_length().map_or(true, |len| len == 1);

    let mut resp_headers = HashMap::new();
    for (key, value) in range_resp.headers().iter() {
        if let Ok(val_str) = value.to_str() {
            resp_headers.insert(key.to_string(), val_str.to_string());
        }
    }

    if range_status != reqwest::StatusCode::PARTIAL_CONTENT
        || !accept_ranges
        || probe_range.map_or(true, |(start, end, _)| start != 0 || end != 0)
        || !probe_body_size_ok
        || total == 0
    {
        return single_threaded_download(&client, url, file_path, &headers, &body, on_progress)
            .await;
    }
    if total > MAX_DOWNLOAD_BYTES {
        return Err(Error::ContentLength(format!(
            "download size {total} exceeds the {MAX_DOWNLOAD_BYTES}-byte limit"
        )));
    }

    // Multi-part download with range access. Write every part to a temporary
    // file and only publish it after all requests have succeeded.
    let part_count = total.div_ceil(PART_SIZE);
    let mut temp = DownloadTempFile::new(file_path);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp.path)
        .await?;
    file.set_len(total).await?;

    let file = Arc::new(tokio::sync::Mutex::new(file));
    let progress = Arc::new(tokio::sync::Mutex::new(TransferStats::default()));

    stream::iter(0..part_count)
        .map(Ok::<u64, Error>)
        .try_for_each_concurrent(8, |i| {
            let client = client.clone();
            let file = Arc::clone(&file);
            let progress = Arc::clone(&progress);
            let headers = headers.clone();
            let url = url.to_string();
            let on_progress = on_progress.clone();

            async move {
                let start = i * PART_SIZE;
                let end = min(start + PART_SIZE - 1, total - 1);
                let range_header = format!("bytes={start}-{end}");

                let mut req = client.get(&url).header("Range", range_header);
                for (key, value) in headers {
                    req = req.header(key, value);
                }

                let resp = req.send().await?;
                if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                    let status = resp.status().as_u16();
                    let body = read_response_body_limited(resp, MAX_ERROR_BODY_BYTES).await?;
                    return Err(Error::HttpErrorCode(
                        status,
                        String::from_utf8_lossy(&body).into_owned(),
                    ));
                }

                let actual_range = resp
                    .headers()
                    .get("content-range")
                    .and_then(|value| value.to_str().ok())
                    .and_then(parse_content_range);
                if actual_range != Some((start, end, total)) {
                    return Err(Error::ContentLength(format!(
                        "invalid Content-Range for bytes {start}-{end}"
                    )));
                }

                let expected_len = end - start + 1;
                let bytes = read_response_body_limited(resp, expected_len).await?;
                if bytes.len() as u64 != expected_len {
                    return Err(Error::ContentLength(format!(
                        "range bytes {start}-{end} returned {} bytes, expected {expected_len}",
                        bytes.len()
                    )));
                }

                {
                    let mut f = file.lock().await;
                    f.seek(std::io::SeekFrom::Start(start)).await?;
                    f.write_all(&bytes).await?;
                }

                {
                    let mut stat = progress.lock().await;
                    stat.record_chunk_transfer(bytes.len());
                    let _ = on_progress.send(ProgressPayload {
                        progress: stat.total_transferred,
                        total,
                        transfer_speed: stat.transfer_speed,
                    });
                }

                Ok(())
            }
        })
        .await?;

    drop(file);
    commit_download_file(&mut temp, file_path).await?;

    Ok(resp_headers)
}

#[command]
pub async fn upload_file(
    app: AppHandle,
    url: &str,
    file_path: &str,
    method: &str,
    headers: HashMap<String, String>,
    on_progress: Channel<ProgressPayload>,
) -> Result<String> {
    ensure_path_allowed(&app, file_path)?;

    let file = File::open(file_path).await?;
    let file_len = file.metadata().await.unwrap().len();

    let client = reqwest::Client::new();
    let mut request = match method.to_uppercase().as_str() {
        "POST" => client.post(url),
        "PUT" => client.put(url),
        _ => return Err(Error::ContentLength("Invalid HTTP method".into())),
    };

    request = request
        .header(reqwest::header::CONTENT_LENGTH, file_len)
        .body(file_to_body(on_progress.clone(), file, file_len));

    for (key, value) in headers {
        request = request.header(&key, value);
    }

    let response = request.send().await?;
    let status = response.status();
    if status.is_success() {
        Ok(response.text().await?)
    } else {
        let body = read_response_body_limited(response, MAX_ERROR_BODY_BYTES).await?;
        Err(Error::HttpErrorCode(
            status.as_u16(),
            String::from_utf8_lossy(&body).into_owned(),
        ))
    }
}

fn file_to_body(channel: Channel<ProgressPayload>, file: File, file_len: u64) -> reqwest::Body {
    let stream = FramedRead::new(file, BytesCodec::new()).map_ok(|r| r.freeze());

    let mut stats = TransferStats::default();
    reqwest::Body::wrap_stream(ReadProgressStream::new(
        stream,
        Box::new(move |progress_chunk, _progress_total| {
            stats.record_chunk_transfer(progress_chunk as usize);
            let _ = channel.send(ProgressPayload {
                progress: stats.total_transferred,
                total: file_len,
                transfer_speed: stats.transfer_speed,
            });
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::{has_disallowed_components, is_path_within_root, parse_content_range};

    #[test]
    fn app_storage_fallback_requires_a_component_boundary() {
        let root = std::env::temp_dir().join("readest-transfer-root");
        assert!(is_path_within_root(
            &root,
            &root.join("Readest").join("Books").join("book.epub")
        ));
        assert!(!is_path_within_root(
            &root,
            &root.with_file_name("readest-transfer-root-shadow").join("book.epub")
        ));
    }

    #[test]
    fn rejects_relative_and_traversal_paths() {
        // Relative paths can't be reasoned about against an absolute scope.
        assert!(has_disallowed_components("relative/file.epub"));
        assert!(has_disallowed_components("file.epub"));
        // `..` traversal, whether the path is relative or absolute.
        assert!(has_disallowed_components("foo/../bar"));
        assert!(has_disallowed_components(
            "/home/user/Readest/../../.ssh/id_rsa"
        ));
    }

    #[test]
    fn parses_and_rejects_content_ranges() {
        assert_eq!(
            parse_content_range("bytes 0-1023/4096"),
            Some((0, 1023, 4096))
        );
        assert_eq!(parse_content_range("bytes 0-1023/*"), None);
        assert_eq!(parse_content_range("bytes 0-1023/4096 "), Some((0, 1023, 4096)));
        assert_eq!(parse_content_range("Bytes 0-1023 / 4096"), Some((0, 1023, 4096)));
        assert_eq!(parse_content_range("items 0-1023/4096"), None);
    }

    #[cfg(unix)]
    #[test]
    fn accepts_plain_absolute_paths() {
        assert!(!has_disallowed_components(
            "/Users/x/Library/Caches/app/book.epub"
        ));
        assert!(!has_disallowed_components("/Users/x/Readest/Books/h.epub"));
    }

    #[cfg(windows)]
    #[test]
    fn accepts_plain_absolute_paths_windows() {
        assert!(!has_disallowed_components(
            "C:\\Users\\x\\AppData\\Roaming\\Readest\\Books\\h.epub"
        ));
    }
}
