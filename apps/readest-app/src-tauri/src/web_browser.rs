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
}

pub const SENTINEL_HOST: &str = "readest-browser.invalid";

#[derive(Debug, PartialEq)]
pub enum SentinelAction {
    Open(String),
    Close,
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

/// The injected chrome signals "Open book" / "Close" by navigating to a
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
pub async fn open_web_browser(
    app: AppHandle,
    url: String,
    options: Option<WebBrowserOptions>,
) -> Result<WebBrowserResult, String> {
    let parsed = parse_browsable_url(&url)?;
    let options = options.unwrap_or_default();
    let label = next_label();
    let download_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("browser-downloads");
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    let (close_tx, close_rx) = tokio::sync::oneshot::channel::<WebBrowserResult>();
    let close_tx = Arc::new(Mutex::new(Some(close_tx)));
    let open_hash: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    // url -> destination chosen in `Requested`; macOS never reports the
    // finished path (wry limitation), so we remember it ourselves.
    let pending: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::new(Mutex::new(HashMap::new()));

    let title = parsed.host_str().unwrap_or("Readest").to_string();

    let nav_app = app.clone();
    let nav_label = label.clone();
    let nav_hash = open_hash.clone();
    let new_window_app = app.clone();
    let new_window_label = label.clone();
    let dl_app = app.clone();
    let dl_pending = pending.clone();
    let dl_dir = download_dir.clone();

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(&title)
        .inner_size(1100.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .center()
        .decorations(true)
        .initialization_script(chrome_script(&options))
        .on_navigation(move |url| {
            if let Some(action) = sentinel_action(url) {
                if let SentinelAction::Open(hash) = action {
                    *nav_hash.lock().unwrap_or_else(|e| e.into_inner()) = Some(hash);
                }
                if let Some(window) = nav_app.get_webview_window(&nav_label) {
                    tauri::async_runtime::spawn(async move {
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
                let hash = open_hash.lock().unwrap_or_else(|e| e.into_inner()).take();
                let _ = tx.send(WebBrowserResult {
                    open_book_hash: hash,
                });
            }
        }
    });

    close_rx
        .await
        .map_err(|_| "Browser window closed".to_string())
}

/// Push an import status (importing / added / failed / unsupported) into
/// every open browser window's chrome.
#[cfg(desktop)]
#[tauri::command]
pub fn set_web_browser_status(app: AppHandle, status: WebBrowserStatus) -> Result<(), String> {
    let js = status_eval(&status);
    for (label, window) in app.webview_windows() {
        if is_browser_label(&label) {
            let _ = window.eval(&js);
        }
    }
    Ok(())
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
    use tauri::Manager;
    use tauri_plugin_native_bridge::{NativeBridgeExt, WebBrowserRequest};

    let parsed = parse_browsable_url(&url)?;
    let options = options.unwrap_or_default();
    let download_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("browser-downloads");
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let request = WebBrowserRequest {
        url: parsed.to_string(),
        download_dir: download_dir.to_string_lossy().into_owned(),
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
    })
}

#[cfg(mobile)]
#[tauri::command]
pub fn set_web_browser_status(
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

    #[test]
    fn sentinel_action_parses_open_and_close() {
        let open = Url::parse("https://readest-browser.invalid/open/abc123").unwrap();
        assert_eq!(
            sentinel_action(&open),
            Some(SentinelAction::Open("abc123".into()))
        );
        let close = Url::parse("https://readest-browser.invalid/close").unwrap();
        assert_eq!(sentinel_action(&close), Some(SentinelAction::Close));
        let other = Url::parse("https://calibre.example.com/open/abc").unwrap();
        assert_eq!(sentinel_action(&other), None);
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
}
