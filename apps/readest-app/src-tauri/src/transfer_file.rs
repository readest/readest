// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Upload files from disk to a remote server over HTTP.
//!
//! Download files from a remote HTTP server to disk.

use futures_util::TryStreamExt;
use serde::{ser::Serializer, Serialize};
use tauri::{command, ipc::Channel, AppHandle, Manager};
use tauri_plugin_fs::FsExt;
use tokio::{
    fs::File,
    io::{AsyncWriteExt, BufWriter},
};
use tokio_util::codec::{BytesCodec, FramedRead};

use read_progress_stream::ReadProgressStream;

use std::path::{Path, PathBuf};
use std::time::Instant;
use std::{collections::HashMap, sync::Arc};

type Result<T> = std::result::Result<T, Error>;

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

/// Resolve existing ancestors too, so a new download beneath a symlink is
/// checked against the directory where it will actually be written.
fn resolve_path(path: &Path) -> std::io::Result<PathBuf> {
    let mut ancestor = path;
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => {
                let mut resolved = std::fs::canonicalize(ancestor)?;
                for name in missing.iter().rev() {
                    resolved.push(name);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = ancestor.file_name() else {
                    return Err(error);
                };
                missing.push(name.to_os_string());
                let Some(parent) = ancestor.parent() else {
                    return Err(error);
                };
                ancestor = parent;
            }
            Err(error) => return Err(error),
        }
    }
}

fn is_within_app_storage(file_path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| file_path.starts_with(root))
}

/// Authorize the resolved path against user grants or real application roots.
/// Callers use the returned path for I/O, never the untrusted spelling.
pub(crate) fn ensure_path_allowed<R: tauri::Runtime>(
    app: &AppHandle<R>,
    file_path: &str,
) -> std::result::Result<PathBuf, Error> {
    if has_disallowed_components(file_path) {
        return Err(Error::Forbidden(file_path.to_string()));
    }
    let resolved = resolve_path(Path::new(file_path))?;
    let scope = app.fs_scope();
    if scope.is_forbidden(&resolved) {
        return Err(Error::Forbidden(file_path.to_string()));
    }
    let roots: Vec<PathBuf> = [
        app.path().app_data_dir(),
        app.path().app_local_data_dir(),
        app.path().app_config_dir(),
        app.path().app_cache_dir(),
    ]
    .into_iter()
    .filter_map(|root| root.ok().and_then(|root| resolve_path(&root).ok()))
    .collect();
    if scope.is_allowed(&resolved) || is_within_app_storage(&resolved, &roots) {
        return Ok(resolved);
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
pub async fn download_file<R: tauri::Runtime>(
    app: AppHandle<R>,
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

    let allowed_path = ensure_path_allowed(&app, file_path)?;
    let file_path = allowed_path.as_path();

    const PART_SIZE: u64 = 1024 * 1024;

    let client = reqwest::ClientBuilder::new()
        .danger_accept_invalid_certs(skip_ssl_verification.unwrap_or(false))
        .danger_accept_invalid_hostnames(skip_ssl_verification.unwrap_or(false))
        .build()?;
    let force_single = single_threaded.unwrap_or(false);

    async fn single_threaded_download(
        client: &reqwest::Client,
        url: &str,
        file_path: &Path,
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
            return Err(Error::HttpErrorCode(
                response.status().as_u16(),
                response.text().await.unwrap_or_default(),
            ));
        }

        let mut resp_headers = HashMap::new();
        for (key, value) in response.headers().iter() {
            if let Ok(val_str) = value.to_str() {
                resp_headers.insert(key.to_string(), val_str.to_string());
            }
        }

        let total = response.content_length().unwrap_or(0);
        let mut file = BufWriter::new(File::create(file_path).await?);
        let mut stream = response.bytes_stream();

        let mut stats = TransferStats::default();
        while let Some(chunk) = stream.try_next().await? {
            file.write_all(&chunk).await?;
            stats.record_chunk_transfer(chunk.len());
            let _ = on_progress.send(ProgressPayload {
                progress: stats.total_transferred,
                total,
                transfer_speed: stats.transfer_speed,
            });
        }
        file.flush().await?;

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
    let accept_ranges = range_resp
        .headers()
        .get("accept-ranges")
        .map(|v| v.to_str().unwrap_or(""))
        .unwrap_or("")
        .eq_ignore_ascii_case("bytes");
    let total = range_resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split('/').nth(1))
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let mut resp_headers = HashMap::new();
    for (key, value) in range_resp.headers().iter() {
        if let Ok(val_str) = value.to_str() {
            resp_headers.insert(key.to_string(), val_str.to_string());
        }
    }

    if !accept_ranges || total == 0 {
        return single_threaded_download(&client, url, file_path, &headers, &body, on_progress)
            .await;
    }

    // Multi-part download with range access
    let part_count = total.div_ceil(PART_SIZE);
    let file = File::create(file_path).await?;
    file.set_len(total).await?;

    let file = Arc::new(tokio::sync::Mutex::new(file));
    let progress = Arc::new(tokio::sync::Mutex::new(TransferStats::default()));

    stream::iter(0..part_count)
        .for_each_concurrent(8, |i| {
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

                let resp = match req.send().await {
                    Ok(r) => r,
                    Err(_) => return,
                };

                if !resp.status().is_success()
                    && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT
                {
                    return;
                }

                let bytes = match resp.bytes().await {
                    Ok(b) => b,
                    Err(_) => return,
                };

                {
                    let mut f = file.lock().await;
                    f.seek(std::io::SeekFrom::Start(start)).await.unwrap();
                    f.write_all(&bytes).await.unwrap();
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
            }
        })
        .await;

    Ok(resp_headers)
}

#[command]
pub async fn upload_file<R: tauri::Runtime>(
    app: AppHandle<R>,
    url: &str,
    file_path: &str,
    method: &str,
    headers: HashMap<String, String>,
    on_progress: Channel<ProgressPayload>,
) -> Result<String> {
    let allowed_path = ensure_path_allowed(&app, file_path)?;
    let file_path = allowed_path.as_path();

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
    if response.status().is_success() {
        response.text().await.map_err(Into::into)
    } else {
        Err(Error::HttpErrorCode(
            response.status().as_u16(),
            response.text().await.unwrap_or_default(),
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
    use super::{has_disallowed_components, is_within_app_storage, resolve_path};
    use std::path::{Path, PathBuf};

    #[test]
    fn app_storage_does_not_authorize_brand_names_in_foreign_paths() {
        let roots = [PathBuf::from(
            "/Users/victim/Library/Application Support/com.bilingify.readest",
        )];
        for path in [
            "/Users/victim/Library/LaunchAgents/Readest-agent.plist",
            "/Users/victim/Documents/com.bilingify.readest-secrets.txt",
            "/Users/victim/Library/Application Support/com.bilingify.readest-other/file",
        ] {
            assert!(!is_within_app_storage(Path::new(path), &roots));
        }
        assert!(is_within_app_storage(
            Path::new("/Users/victim/Library/Application Support/com.bilingify.readest/Readest/Books/book.epub"),
            &roots,
        ));
    }

    #[cfg(unix)]
    #[test]
    fn resolves_symlinks_before_authorizing_new_downloads() {
        let temp = std::env::temp_dir().join(format!("readest-path-scope-{}", std::process::id()));
        let app = temp.join("app");
        let outside = temp.join("outside");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, app.join("escape")).unwrap();
        let roots = [std::fs::canonicalize(&app).unwrap()];
        let target = resolve_path(&app.join("escape/new/file.epub")).unwrap();
        assert!(!is_within_app_storage(&target, &roots));
        assert!(is_within_app_storage(
            &resolve_path(&app.join("Books/new.epub")).unwrap(),
            &roots
        ));
        std::os::unix::fs::symlink(temp.join("missing"), app.join("dangling")).unwrap();
        assert!(resolve_path(&app.join("dangling/file.epub")).is_err());
        std::fs::remove_dir_all(temp).unwrap();
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
