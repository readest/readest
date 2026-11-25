//! `download_file`, Readest's command (src-tauri/src/transfer_file.rs) that saves a file from the
//! network: covers and books from Readest Cloud, dictionaries, WebDAV and OPDS downloads. Without
//! it a library synced from Readest Cloud shows generated covers only.

use std::{
    collections::HashMap,
    fs::File,
    io::{BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel};
use tauri_plugin_fs::FsExt;
// The client of the runtime's `fetch`: a stalled network fails the download, a long one is fine.
use tauri_runtime_blitz::http_agent;

/// What Readest's `tauriDownload` hands its progress handler.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    progress: u64,
    total: u64,
    transfer_speed: u64,
}

/// Whether the app may write at `path`: in one of its own data folders (`roots`), or in a folder a
/// user granted. A path that climbs with `..` never may.
fn may_write(path: &Path, roots: &[PathBuf], granted: impl Fn(&Path) -> bool) -> bool {
    path.is_absolute()
        && !path.components().any(|c| c == Component::ParentDir)
        && (roots.iter().any(|root| path.starts_with(root)) || granted(path))
}

/// `download_file` as Readest calls it (`tauriDownload` in src/utils/transfer.ts). Its multi-part
/// download and certificate options are not offered: one stream, verified.
#[tauri::command]
pub async fn download_file<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    file_path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    on_progress: Channel<ProgressPayload>,
) -> Result<HashMap<String, String>, String> {
    let path = PathBuf::from(&file_path);
    let roots: Vec<PathBuf> = [
        app.path().app_data_dir(),
        app.path().app_local_data_dir(),
        app.path().app_config_dir(),
        app.path().app_cache_dir(),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .collect();
    let scope = app.fs_scope();
    if scope.is_forbidden(&path) || !may_write(&path, &roots, |p| scope.is_allowed(p)) {
        return Err(format!("{file_path}: not allowed"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        download(&url, &path, &headers, body, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Fetches `url` (a POST when there is a `body`) into `path`, reporting progress, and returns the
/// response's headers. An error status fails, and no file is left behind.
fn download(
    url: &str,
    path: &Path,
    headers: &HashMap<String, String>,
    body: Option<String>,
    mut progress: impl FnMut(ProgressPayload),
) -> Result<HashMap<String, String>, String> {
    let response = match body {
        Some(body) => headers
            .iter()
            .fold(http_agent().post(url), |r, (k, v)| r.header(k, v))
            .send(body),
        None => headers
            .iter()
            .fold(http_agent().get(url), |r, (k, v)| r.header(k, v))
            .call(),
    }
    .map_err(|e| e.to_string())?;
    let status = response.status();
    let headers: HashMap<String, String> = response
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let mut body = response.into_body();
    if !status.is_success() {
        let text = body.read_to_string().unwrap_or_default();
        return Err(format!("HTTP {}: {text}", status.as_u16()));
    }
    let total = headers
        .get("content-length")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    let reader = body.into_with_config().limit(u64::MAX).reader();
    if let Err(e) = save(reader, path, total, &mut progress) {
        let _ = std::fs::remove_file(path);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(headers)
}

/// Writes `reader` to `path`, reporting progress at most twice a second, and once at the end.
fn save(
    mut reader: impl Read,
    path: &Path,
    total: u64,
    progress: &mut impl FnMut(ProgressPayload),
) -> std::io::Result<()> {
    let mut file = BufWriter::new(File::create(path)?);
    let start = Instant::now();
    let report = |done: u64| ProgressPayload {
        progress: done,
        total,
        transfer_speed: (done as f64 / start.elapsed().as_secs_f64().max(0.001)) as u64,
    };
    let (mut done, mut reported) = (0, start);
    let mut buf = vec![0; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        done += n as u64;
        if reported.elapsed() >= Duration::from_millis(500) {
            reported = Instant::now();
            progress(report(done));
        }
    }
    file.flush()?;
    progress(report(done));
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        io::{Read, Write},
        path::{Path, PathBuf},
        sync::mpsc,
    };

    use super::{download, may_write};

    /// Answers one HTTP request with `head` and `body`; returns its URL and the request it got.
    fn serve_once(head: &str, body: &[u8]) -> (String, mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/cover.png", listener.local_addr().unwrap());
        let response = [head.as_bytes(), body].concat();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") && stream.read(&mut byte).unwrap() == 1 {
                request.push(byte[0]);
            }
            let text = String::from_utf8_lossy(&request).into_owned();
            let length = text
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(String::from)
                })
                .and_then(|n| n.trim().parse().ok())
                .unwrap_or(0);
            let mut sent = vec![0; length];
            stream.read_exact(&mut sent).unwrap();
            stream.write_all(&response).unwrap();
            tx.send(text + &String::from_utf8_lossy(&sent)).unwrap();
        });
        (url, rx)
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("readest-lite-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_the_file_and_returns_its_headers() {
        let dir = temp_dir("download");
        let cover = b"\x89PNG cover bytes!";
        let (url, request) = serve_once(
            &format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                cover.len()
            ),
            cover,
        );
        let path = dir.join("cover.png");
        let headers = HashMap::from([("X-Token".to_string(), "t".to_string())]);
        let mut last = None;
        let got = download(&url, &path, &headers, None, |p| {
            last = Some((p.progress, p.total))
        });
        assert_eq!(
            got.unwrap().get("content-type").map(String::as_str),
            Some("image/png")
        );
        assert_eq!(std::fs::read(&path).unwrap(), cover);
        assert_eq!(last, Some((17, 17)));
        let request = request.recv().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /cover.png"), "{request}");
        assert!(request.contains("x-token: t"), "{request}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sends_a_body_as_a_post() {
        let dir = temp_dir("download-post");
        let (url, request) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n",
            b"ok",
        );
        download(
            &url,
            &dir.join("f"),
            &HashMap::new(),
            Some("{\"q\":1}".into()),
            |_| {},
        )
        .unwrap();
        let request = request.recv().unwrap();
        assert!(request.starts_with("POST /cover.png"), "{request}");
        assert!(request.ends_with("{\"q\":1}"), "{request}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A failed answer is an error, and leaves no file to show as a broken cover.
    #[test]
    fn fails_on_an_error_status_and_leaves_no_file() {
        let dir = temp_dir("download-404");
        let (url, _) = serve_once(
            "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\n",
            b"not found",
        );
        let path = dir.join("cover.png");
        let err = download(&url, &path, &HashMap::new(), None, |_| {}).unwrap_err();
        assert!(err.contains("404"), "{err}");
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_only_in_the_app_folders_and_granted_ones() {
        let roots = [PathBuf::from("/data/com.bilingify.readest-lite")];
        let granted = |p: &Path| p.starts_with("/mnt/us/documents");
        let ok = |p: &str| may_write(Path::new(p), &roots, granted);
        assert!(ok(
            "/data/com.bilingify.readest-lite/Readest/Books/abc/cover.png"
        ));
        assert!(ok("/mnt/us/documents/novel.epub"));
        assert!(!ok("/etc/passwd"));
        assert!(!ok("/data/com.bilingify.readest-lite/../other/cover.png"));
        assert!(!ok("/mnt/us/documents/../system/x"));
        assert!(!ok("Readest/Books/cover.png"));
    }
}
