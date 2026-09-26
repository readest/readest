//! In-app web browser used as a book source (#5775).
//!
//! Desktop: a top-level `WebviewWindow` on the remote URL with `on_download`
//! interception and chrome injected into the page (see `web_browser_chrome.js`).
//! Mobile: delegated to `tauri-plugin-native-bridge`, which presents a native
//! `WKWebView` / `WebView` controller (`WebBrowserController.swift/.kt`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Url;
use tauri_plugin_native_bridge::WebBrowserPage;

const CAPTURE_JS: &str = include_str!("web_browser_capture.js");

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WebBrowserOptions {
    pub background: Option<String>,
    pub foreground: Option<String>,
    pub is_eink: Option<bool>,
    pub labels: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebBrowserDownload {
    pub url: String,
    pub path: String,
    pub filename: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebBrowserStatus {
    pub state: String,
    pub filename: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_hash: Option<String>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebBrowserResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_book_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<WebBrowserPage>,
}

pub const SENTINEL_HOST: &str = "readest-browser.invalid";

#[derive(Debug, PartialEq)]
pub enum SentinelAction {
    Open(String),
    Close,
    Capture,
}

/// Accept only http(s). A bare host ("calibre.example.com") gets `https://`.
pub fn parse_browsable_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Invalid URL".into());
    }
    let has_scheme = trimmed
        .split_once(':')
        .map(|(scheme, _)| {
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
                && scheme
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic())
        })
        .unwrap_or(false);
    let candidate = if has_scheme {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate).map_err(|_| "Invalid URL".to_string())?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(url),
        _ => Err("Invalid URL".into()),
    }
}

/// Filename for an intercepted download: the server's suggested name when
/// present, else the last URL path segment (query stripped), else "download".
/// Path separators and other reserved characters become `_`.
pub fn download_filename(suggested: Option<&str>, url: &Url) -> String {
    let from_suggestion = suggested
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let from_url = url
        .path_segments()
        .and_then(|mut segs| segs.next_back().map(str::to_string))
        .filter(|s| !s.is_empty());
    let raw = from_suggestion
        .or(from_url)
        .unwrap_or_else(|| "download".into());
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "download".into()
    } else {
        cleaned
    }
}

/// `dir/name`, or `dir/name (n).ext` for the first free `n`.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("unbounded counter")
}

const MAX_ARCHIVE_EXPANSION: u64 = 20;
// An item download holds a book or two; thousands of tiny ones only exhaust inodes.
const MAX_ARCHIVE_BOOKS: usize = 100;

/// Servers such as Audiobookshelf hand out a multi-file item as a plain zip
/// (`Title.zip` holding `Title.epub`, the cover, audio tracks...). Extract
/// the entries whose extension is in `exts` next to the archive, then drop
/// it. Returns an empty list, leaving the archive in place, when it is an
/// EPUB saved under a `.zip` name or holds no such entry. Entries are
/// streamed to disk, so a large audiobook archive is never held in memory.
pub fn extract_archive_books(archive: &Path, exts: &[String]) -> Result<Vec<PathBuf>, String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    // Books are stored or already compressed, so a real book archive barely
    // expands; past this ratio it is a zip bomb that would fill the disk.
    let mut budget = file
        .metadata()
        .map_err(|e| e.to_string())?
        .len()
        .saturating_mul(MAX_ARCHIVE_EXPANSION);
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if zip.index_for_name("META-INF/container.xml").is_some() {
        return Ok(Vec::new());
    }
    let dir = archive.parent().ok_or("Invalid path")?;
    let mut books = Vec::new();
    let mut extract = || -> Result<(), String> {
        for i in 0..zip.len() {
            let entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let Some(name) = entry
                .enclosed_name()
                .and_then(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
            else {
                continue;
            };
            // Skip `__MACOSX/._Title.epub` resource forks and other dotfiles.
            let is_book = entry.is_file()
                && !name.starts_with('.')
                && name
                    .rsplit_once('.')
                    .is_some_and(|(_, ext)| exts.iter().any(|e| e.eq_ignore_ascii_case(ext)));
            if !is_book {
                continue;
            }
            if books.len() == MAX_ARCHIVE_BOOKS {
                return Err("Archive holds too many books".into());
            }
            let path = unique_path(dir, &name);
            books.push(path.clone());
            let mut out = std::fs::File::create(&path).map_err(|e| e.to_string())?;
            let written = std::io::copy(&mut std::io::Read::take(entry, budget + 1), &mut out)
                .map_err(|e| e.to_string())?;
            if written > budget {
                return Err("Archive expands too much to hold books".into());
            }
            budget -= written;
        }
        Ok(())
    };
    if let Err(error) = extract() {
        for path in &books {
            let _ = std::fs::remove_file(path);
        }
        return Err(error);
    }
    if !books.is_empty() {
        let _ = std::fs::remove_file(archive);
    }
    Ok(books)
}

/// The injected chrome signals "Open book", "Close", or "Clip Page" by navigating to a
/// sentinel host; `on_navigation` blocks the request and acts instead.
pub fn sentinel_action(url: &Url) -> Option<SentinelAction> {
    if url.host_str() != Some(SENTINEL_HOST) {
        return None;
    }
    let mut segs = url.path_segments()?;
    match (segs.next(), segs.next()) {
        (Some("open"), Some(hash)) if !hash.is_empty() => {
            Some(SentinelAction::Open(hash.to_string()))
        }
        (Some("close"), _) => Some(SentinelAction::Close),
        (Some("capture"), None) => Some(SentinelAction::Capture),
        _ => None,
    }
}

/// JS snippet that pushes an import status into the injected chrome.
pub fn status_eval(status: &WebBrowserStatus) -> String {
    let json = serde_json::to_string(status).unwrap_or_else(|_| "{}".into());
    format!("window.__readestBrowser && window.__readestBrowser.setStatus({json});")
}

#[cfg(desktop)]
const CHROME_JS: &str = include_str!("web_browser_chrome.js");

/// Wraps the chrome script with the JSON-encoded options so translated
/// labels and theme colours cannot break out of the string context.
#[cfg(desktop)]
pub fn chrome_script(options: &WebBrowserOptions) -> String {
    let options_json = serde_json::json!({
        "background": options.background,
        "foreground": options.foreground,
        "isEink": options.is_eink.unwrap_or(false),
        "labels": options.labels,
    });
    CHROME_JS.replace("__READEST_BROWSER_OPTIONS__", &options_json.to_string())
}

#[cfg(desktop)]
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
#[cfg(target_os = "windows")]
use tauri::webview::ScrollBarStyle;
#[cfg(desktop)]
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_opener::OpenerExt;

#[cfg(desktop)]
fn next_label() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!("browser-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(desktop)]
fn is_browser_label(label: &str) -> bool {
    label.starts_with("browser-")
}

/// Open `url` in a new top-level browser window. Resolves when the window
/// closes; `open_book_hash` is set when the user pressed [Open] on an
/// imported book. Downloads are emitted as `web-browser-download` events
/// (see `WebBrowserDownload`).
#[cfg(desktop)]
#[tauri::command]
pub async fn open_web_browser<R: tauri::Runtime>(
    app: AppHandle<R>,
    url: String,
    options: Option<WebBrowserOptions>,
) -> Result<WebBrowserResult, String> {
    let parsed = parse_browsable_url(&url)?;
    let options = options.unwrap_or_default();
    let label = next_label();
    let download_dir = browser_downloads_dir(&app)?;
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    let (close_tx, close_rx) = tokio::sync::oneshot::channel::<WebBrowserResult>();
    let close_tx = Arc::new(Mutex::new(Some(close_tx)));
    let result = Arc::new(Mutex::new(WebBrowserResult::default()));
    // url -> destination chosen in `Requested`; macOS never reports the
    // finished path (wry limitation), so we remember it ourselves.
    let pending: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::new(Mutex::new(HashMap::new()));

    let title = parsed.host_str().unwrap_or("Readest").to_string();

    let nav_app = app.clone();
    let nav_label = label.clone();
    let nav_result = result.clone();
    let new_window_app = app.clone();
    let new_window_label = label.clone();
    let dl_app = app.clone();
    let dl_pending = pending.clone();
    let dl_dir = download_dir.clone();

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(&title)
        // Match the session-backed HTTP and rendered chapter fetchers.
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .inner_size(1100.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .center()
        .decorations(true)
        .initialization_script(chrome_script(&options))
        .on_navigation(move |url| {
            if let Some(action) = sentinel_action(url) {
                if let Some(window) = nav_app.get_webview_window(&nav_label) {
                    let result = nav_result.clone();
                    tauri::async_runtime::spawn(async move {
                        match action {
                            SentinelAction::Capture => {
                                capture_browser_page(window, result);
                                return;
                            }
                            SentinelAction::Open(hash) => {
                                result
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .open_book_hash = Some(hash);
                            }
                            SentinelAction::Close => {}
                        }
                        let _ = window.close();
                    });
                }
                return false;
            }
            match url.scheme() {
                "http" | "https" | "about" | "blob" | "data" => true,
                _ => {
                    let _ = nav_app.opener().open_url(url.to_string(), None::<&str>);
                    false
                }
            }
        })
        .on_new_window(move |url, _features| {
            // target=_blank / window.open: keep the user in this window.
            if let Some(window) = new_window_app.get_webview_window(&new_window_label) {
                tauri::async_runtime::spawn(async move {
                    let _ = window.navigate(url);
                });
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, title| {
            if !title.trim().is_empty() {
                let _ = window.set_title(&title);
            }
        })
        .on_download(move |webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let suggested = destination
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::to_string);
                let name = download_filename(suggested.as_deref(), &url);
                let path = unique_path(&dl_dir, &name);
                dl_pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(url.to_string(), path.clone());
                *destination = path;
                let _ = webview.eval(status_eval(&WebBrowserStatus {
                    state: "downloading".into(),
                    filename: name,
                    book_hash: None,
                }));
                true
            }
            DownloadEvent::Finished { url, path, success } => {
                let chosen = dl_pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(url.as_str());
                if let Some(dest) = chosen.or(path) {
                    let filename = dest
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("download")
                        .to_string();
                    // A failed/cancelled download leaves a partial file behind; drop
                    // it so the cache does not fill and the next attempt reuses the name.
                    if !success {
                        let _ = std::fs::remove_file(&dest);
                    }
                    let _ = dl_app.emit(
                        "web-browser-download",
                        WebBrowserDownload {
                            url: url.to_string(),
                            path: dest.to_string_lossy().into_owned(),
                            filename,
                            success,
                            error: (!success).then(|| "Download failed".to_string()),
                        },
                    );
                }
                true
            }
            _ => true,
        });

    // WebView2 refuses a webview whose environment options differ from the
    // browser process already running (HRESULT 0x8007139F); scroll bar style
    // is one of them, so match the main window (lib.rs).
    #[cfg(target_os = "windows")]
    let builder = builder.scroll_bar_style(ScrollBarStyle::FluentOverlay);

    let window = builder.build().map_err(|e| e.to_string())?;

    let done_tx = close_tx.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(tx) = done_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let result = std::mem::take(&mut *result.lock().unwrap_or_else(|e| e.into_inner()));
                let _ = tx.send(result);
            }
        }
    });

    close_rx
        .await
        .map_err(|_| "Browser window closed".to_string())
}

/// Read the displayed DOM through the native evaluation callback. The remote
/// page gets no Tauri IPC permissions and the HTML never travels over a URL.
#[cfg(desktop)]
fn capture_browser_page<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    result: Arc<Mutex<WebBrowserResult>>,
) {
    let failed = status_eval(&WebBrowserStatus {
        state: "failed".into(),
        filename: String::new(),
        book_hash: None,
    });
    let callback_window = window.clone();
    let callback_failed = failed.clone();
    if window
        .eval_with_callback(CAPTURE_JS, move |json| {
            if let Ok(page) = serde_json::from_str::<WebBrowserPage>(&json) {
                if parse_browsable_url(&page.url).is_ok() && !page.html.is_empty() {
                    result.lock().unwrap_or_else(|e| e.into_inner()).page = Some(page);
                    let window = callback_window.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = window.close();
                    });
                    return;
                }
            }
            let _ = callback_window.eval(&callback_failed);
        })
        .is_err()
    {
        let _ = window.eval(&failed);
    }
}

/// Push an import status (importing / added / failed / unsupported) into
/// every open browser window's chrome.
#[cfg(desktop)]
#[tauri::command]
pub fn set_web_browser_status<R: tauri::Runtime>(
    app: AppHandle<R>,
    status: WebBrowserStatus,
) -> Result<(), String> {
    let js = status_eval(&status);
    for (label, window) in app.webview_windows() {
        if is_browser_label(&label) {
            let _ = window.eval(&js);
        }
    }
    Ok(())
}

/// Unpack a downloaded `.zip` that holds books (see `extract_archive_books`).
/// Only the file name of `path` is used, so this never reaches outside the
/// browser download directory.
#[tauri::command]
pub async fn extract_web_browser_archive<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    exts: Vec<String>,
) -> Result<Vec<String>, String> {
    let name = Path::new(&path).file_name().ok_or("Invalid path")?;
    let archive = browser_downloads_dir(&app)?.join(name);
    let books =
        tauri::async_runtime::spawn_blocking(move || extract_archive_books(&archive, &exts))
            .await
            .map_err(|e| e.to_string())??;
    Ok(books
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

fn browser_downloads_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("browser-downloads"))
}

/// Mobile: the native-bridge plugin presents `WebBrowserController`.
/// Same JS surface as desktop: resolves when the browser closes.
#[cfg(mobile)]
#[tauri::command]
pub async fn open_web_browser(
    app: tauri::AppHandle,
    url: String,
    options: Option<WebBrowserOptions>,
) -> Result<WebBrowserResult, String> {
    use tauri_plugin_native_bridge::{NativeBridgeExt, WebBrowserRequest};

    let parsed = parse_browsable_url(&url)?;
    let options = options.unwrap_or_default();
    let download_dir = browser_downloads_dir(&app)?;
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let request = WebBrowserRequest {
        url: parsed.to_string(),
        download_dir: download_dir.to_string_lossy().into_owned(),
        capture_script: CAPTURE_JS.to_string(),
        background: options.background,
        foreground: options.foreground,
        is_eink: options.is_eink,
        labels: options.labels,
    };
    // `open_web_browser` blocks until the native browser closes, which can be
    // minutes. Run it on the blocking pool so it never parks an async worker.
    let response =
        tauri::async_runtime::spawn_blocking(move || app.native_bridge().open_web_browser(request))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    Ok(WebBrowserResult {
        open_book_hash: response.open_book_hash,
        page: response.page,
    })
}

/// Must stay `async`: on iOS `invoke()` arrives through the `ipc` custom scheme,
/// which WKWebView dispatches on the MAIN thread, and a synchronous command body
/// runs inline there. `run_mobile_plugin` would then park the main thread until
/// the Swift handler replies from the main queue — a deadlock the watchdog ends
/// with `0x8badf00d`. `async` moves the body onto the async runtime instead.
#[cfg(mobile)]
#[tauri::command]
pub async fn set_web_browser_status(
    app: tauri::AppHandle,
    status: WebBrowserStatus,
) -> Result<(), String> {
    use tauri_plugin_native_bridge::{NativeBridgeExt, WebBrowserStatusRequest};
    app.native_bridge()
        .set_web_browser_status(WebBrowserStatusRequest {
            state: status.state,
            filename: status.filename,
            book_hash: status.book_hash,
        })
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_browsable_url_accepts_http_and_https_only() {
        assert!(parse_browsable_url("https://calibre.example.com").is_ok());
        assert!(parse_browsable_url("http://192.168.1.10:8083/").is_ok());
        assert!(parse_browsable_url("ftp://example.com").is_err());
        assert!(parse_browsable_url("javascript:alert(1)").is_err());
        assert!(parse_browsable_url("not a url").is_err());
    }

    #[test]
    fn parse_browsable_url_adds_https_when_scheme_is_missing() {
        let url = parse_browsable_url("calibre.example.com/opds").unwrap();
        assert_eq!(url.as_str(), "https://calibre.example.com/opds");
    }

    #[test]
    fn download_filename_prefers_suggested_name_and_sanitises_it() {
        let url = Url::parse("https://x.example/download/42/epub").unwrap();
        assert_eq!(
            download_filename(Some("Dune: Part/One.epub"), &url),
            "Dune_ Part_One.epub"
        );
        assert_eq!(download_filename(Some("  "), &url), "epub");
        assert_eq!(download_filename(None, &url), "epub");
    }

    #[test]
    fn download_filename_falls_back_to_last_path_segment_without_query() {
        let url = Url::parse("https://x.example/books/dune.epub?token=abc").unwrap();
        assert_eq!(download_filename(None, &url), "dune.epub");
        let root = Url::parse("https://x.example/").unwrap();
        assert_eq!(download_filename(None, &root), "download");
    }

    #[test]
    fn unique_path_appends_counter_when_file_exists() {
        let dir = std::env::temp_dir().join(format!("readest-wb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("dune.epub"), b"x").unwrap();
        std::fs::write(dir.join("dune (1).epub"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "dune.epub"), dir.join("dune (2).epub"));
        assert_eq!(unique_path(&dir, "other.epub"), dir.join("other.epub"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }

    fn book_exts() -> Vec<String> {
        vec!["epub".into(), "pdf".into()]
    }

    // Audiobookshelf serves every folder item as `<title>.zip`.
    #[test]
    fn extract_archive_books_unpacks_book_files_and_drops_the_archive() {
        let dir = std::env::temp_dir().join(format!("readest-wb-zip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Dune.epub"), b"older download").unwrap();
        let archive = dir.join("Dune.zip");
        write_zip(
            &archive,
            &[
                ("Dune.epub", b"epub bytes"),
                ("extras/Dune Maps.PDF", b"pdf bytes"),
                ("cover.jpg", b"jpg"),
                ("desc.txt", b"description"),
                ("01 - Chapter.mp3", b"mp3"),
                ("__MACOSX/._Dune.epub", b"resource fork"),
            ],
        );

        let books = extract_archive_books(&archive, &book_exts()).unwrap();

        assert_eq!(
            books,
            vec![dir.join("Dune (1).epub"), dir.join("Dune Maps.PDF")]
        );
        assert_eq!(std::fs::read(&books[0]).unwrap(), b"epub bytes");
        assert_eq!(std::fs::read(&books[1]).unwrap(), b"pdf bytes");
        assert!(!archive.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_archive_books_leaves_non_book_archives_alone() {
        let dir = std::env::temp_dir().join(format!("readest-wb-zip2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // An EPUB saved under a .zip name is a book in its own right.
        let epub = dir.join("book.zip");
        write_zip(
            &epub,
            &[
                ("mimetype", b"application/epub+zip"),
                ("META-INF/container.xml", b"<container/>"),
                ("OEBPS/bundled.pdf", b"pdf"),
            ],
        );
        let audio = dir.join("audio.zip");
        write_zip(&audio, &[("01.mp3", b"mp3"), ("cover.jpg", b"jpg")]);

        assert!(extract_archive_books(&epub, &book_exts())
            .unwrap()
            .is_empty());
        assert!(extract_archive_books(&audio, &book_exts())
            .unwrap()
            .is_empty());
        assert!(epub.exists() && audio.exists());
        assert!(extract_archive_books(&dir.join("missing.zip"), &book_exts()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_archive_books_refuses_a_zip_bomb_and_cleans_up() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("readest-wb-zip3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("bomb.zip");
        let mut w = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let deflated = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        w.start_file("a.epub", deflated).unwrap();
        w.write_all(b"small book").unwrap();
        w.start_file("b.epub", deflated).unwrap();
        w.write_all(&vec![0u8; 8 * 1024 * 1024]).unwrap();
        w.finish().unwrap();

        assert!(extract_archive_books(&archive, &book_exts()).is_err());
        // Nothing half-extracted is left behind, and the archive is kept.
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(left, vec![archive.clone()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_archive_books_refuses_an_archive_of_countless_books() {
        let dir = std::env::temp_dir().join(format!("readest-wb-zip4-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("many.zip");
        let names: Vec<String> = (0..=MAX_ARCHIVE_BOOKS)
            .map(|i| format!("{i}.epub"))
            .collect();
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), &b"x"[..])).collect();
        write_zip(&archive, &entries);

        assert!(extract_archive_books(&archive, &book_exts()).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sentinel_action_parses_open_and_close() {
        let open = Url::parse("https://readest-browser.invalid/open/abc123").unwrap();
        assert_eq!(
            sentinel_action(&open),
            Some(SentinelAction::Open("abc123".into()))
        );
        let close = Url::parse("https://readest-browser.invalid/close").unwrap();
        assert_eq!(sentinel_action(&close), Some(SentinelAction::Close));
        let capture = Url::parse("https://readest-browser.invalid/capture").unwrap();
        assert_eq!(sentinel_action(&capture), Some(SentinelAction::Capture));
        let other_capture = Url::parse("https://calibre.example.com/capture").unwrap();
        assert_eq!(sentinel_action(&other_capture), None);
        let other = Url::parse("https://calibre.example.com/open/abc").unwrap();
        assert_eq!(sentinel_action(&other), None);
    }

    #[test]
    fn browser_result_preserves_captured_page_and_omits_absent_fields() {
        let page: WebBrowserPage = serde_json::from_str(
            r#"{"url":"https://example.com/members/chapter-2","html":"<article>日本語</article>"}"#,
        )
        .unwrap();
        let result = WebBrowserResult {
            page: Some(page),
            ..Default::default()
        };
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["page"]["url"], "https://example.com/members/chapter-2");
        assert_eq!(json["page"]["html"], "<article>日本語</article>");
        assert!(json.get("openBookHash").is_none());
        assert_eq!(
            serde_json::to_value(WebBrowserResult::default()).unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn status_eval_is_a_guarded_json_call() {
        let status = WebBrowserStatus {
            state: "added".into(),
            filename: "du\"ne.epub".into(),
            book_hash: Some("h1".into()),
        };
        let js = status_eval(&status);
        assert!(js.starts_with("window.__readestBrowser && window.__readestBrowser.setStatus("));
        assert!(js.contains("\"state\":\"added\""));
        assert!(js.contains("\"filename\":\"du\\\"ne.epub\""));
        assert!(js.contains("\"bookHash\":\"h1\""));
    }

    #[cfg(desktop)]
    #[test]
    fn chrome_script_inlines_options_as_json() {
        let mut options = WebBrowserOptions::default();
        options.background = Some("#ffffff".into());
        options.labels.insert("back".into(), "Zurück".into());
        let js = chrome_script(&options);
        assert!(!js.contains("__READEST_BROWSER_OPTIONS__"));
        assert!(js.contains("})({"));
        assert!(js.contains("\"background\":\"#ffffff\""));
        assert!(js.contains("\"back\":\"Zurück\""));
        assert!(js.contains("readest-browser.invalid"));
        assert!(js.contains("__readestBrowser"));
    }

    // Regression guard for #5775: a long download filename must ellipsize the
    // status text instead of clipping the [Open] button. That needs the
    // ellipsis on a shrinkable text child plus a non-shrinking Open button,
    // not `text-overflow` on the flex container, where it has no effect.
    #[cfg(desktop)]
    #[test]
    fn chrome_script_keeps_open_button_from_clipping() {
        let js = chrome_script(&WebBrowserOptions::default());
        // The filename lives in a dedicated span that ellipsizes...
        assert!(js.contains(".status-text{"));
        assert!(js.contains("text-overflow:ellipsis"));
        // ...and the Open button never shrinks away (flex:none in its rule).
        let open_rule = js
            .split(".open{")
            .nth(1)
            .and_then(|rest| rest.split('}').next())
            .expect("chrome CSS defines an .open rule");
        assert!(
            open_rule.contains("flex:none"),
            "the Open button must not shrink/clip: {open_rule}"
        );
    }

    /// Regression guard for the iOS watchdog kill (`0x8badf00d`) that fired on
    /// every finished in-app-browser download: `invoke()` on iOS is a
    /// `fetch("ipc://…")` and WKWebView runs the scheme handler on the MAIN
    /// thread, where a non-`async` `#[tauri::command]` body executes inline.
    /// `run_mobile_plugin` then parks that thread on a channel until the Swift
    /// handler answers — which it does from `DispatchQueue.main.async`, i.e.
    /// never. Any command that reaches the native bridge must be `async` so it
    /// runs on the async runtime instead.
    ///
    /// This is a source scan rather than a type-level assertion because
    /// `pnpm test:rust` builds for the host, where `#[cfg(mobile)]` commands are
    /// not compiled at all.
    #[test]
    fn commands_reaching_the_native_bridge_are_async() {
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        for entry in walkdir::WalkDir::new(&src_dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "rs"))
        {
            let text = std::fs::read_to_string(entry.path()).unwrap();
            // Commands never live in a test module, and this very test mentions
            // the attribute in its prose — stop at `#[cfg(test)]`.
            let text = text.split("\n#[cfg(test)]").next().unwrap();
            // Both spellings are in use here, so normalise before splitting.
            let text = text.replace("#[tauri::command]", "#[command]");
            for chunk in text.split("#[command]").skip(1) {
                // Signature is everything up to the opening brace; the body ends
                // at the first `}` in column 0 (rustfmt puts top-level items there).
                let Some(brace) = chunk.find('{') else {
                    continue;
                };
                let (signature, rest) = chunk.split_at(brace);
                let body = rest.split_once("\n}").map_or(rest, |(b, _)| b);
                if !body.contains(".native_bridge()") || signature.contains("async fn") {
                    continue;
                }
                let name = signature
                    .split("fn ")
                    .nth(1)
                    .and_then(|s| s.split(['(', '<']).next())
                    .unwrap_or("<unknown>")
                    .trim()
                    .to_string();
                offenders.push(format!("{}: {}", entry.path().display(), name));
            }
        }
        assert!(
            offenders.is_empty(),
            "these commands call into the native bridge from a synchronous \
             `#[tauri::command]`, which deadlocks the iOS main thread and gets the \
             app killed by the watchdog — make them `async fn`: {offenders:#?}"
        );
    }
}
