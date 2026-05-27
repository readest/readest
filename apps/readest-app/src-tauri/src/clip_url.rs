// Spawn a hidden Tauri webview that loads the target URL with the real
// browser engine (WebKit2GTK / WKWebView / WebView2), wait for the page to
// render including JS, and stream the rendered `outerHTML` back to the
// caller. Solves the Cloudflare / Medium / paywall case the Rust HTTP
// client cannot: a real browser carries the correct TLS fingerprint and
// runs the page's own scripts, so bot challenges resolve naturally.
//
// Bridge from webview → Rust:
//
//   The first attempt used a custom `readest-clip://` URI scheme + `fetch`.
//   WebKit treats custom (non-https) schemes as *insecure content* when
//   called from an https origin and blocks them — that's not a CSP rule we
//   can relax. Browsers DO treat `http://127.0.0.1` as a potentially-
//   trustworthy origin (no mixed-content block from https), so we spin up
//   a one-shot localhost HTTP server per clip and the init script POSTs
//   the outerHTML to it. Same pattern `tauri-plugin-oauth` uses.
//
// Wire shape:
//
//   [JS]                       [Rust]                       [hidden webview]
//   invoke('clip_url', url) ─┬─▶ bind 127.0.0.1:RANDOM_PORT
//                            │
//                            ├─▶ WebviewWindowBuilder::External(url)
//                            │   + initialization_script(port, token)
//                            │
//                            │            (page loads, JS runs)
//                            │
//                            │   ◀─── fetch('http://127.0.0.1:{port}/clip/{token}',
//                            │           { method: 'POST', body: outerHTML })
//                            │
//                            │   the tokio listener accepts, parses the
//                            │   request, sends body via oneshot
//                            │
//                            ▼
//   ◀── outerHTML                close webview, return HTML

use serde::Deserialize;
use tauri::AppHandle;

#[cfg(desktop)]
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
#[cfg(desktop)]
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(desktop)]
use tokio::net::TcpListener;
#[cfg(desktop)]
use tokio::sync::oneshot;

/// Localised strings and theme colours supplied by the JS caller. Defaults
/// are English / Readest's dark palette so a caller that omits a field
/// (tests, future Rust-only callers) still gets readable text and chrome.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipOptions {
    pub window_title: Option<String>,
    pub overlay_title: Option<String>,
    pub loading_status: Option<String>,
    pub capturing_status: Option<String>,
    pub saved_title: Option<String>,
    /// `#rrggbb` — matches `themeCode.bg` (base-100) in the renderer.
    pub background: Option<String>,
    /// `#rrggbb` — matches `themeCode.fg` (base-content) in the renderer.
    pub foreground: Option<String>,
}

impl ClipOptions {
    fn window_title(&self) -> &str {
        self.window_title
            .as_deref()
            .unwrap_or("Saving to your Readest library…")
    }
    fn overlay_title(&self) -> &str {
        self.overlay_title.as_deref().unwrap_or("Saving to Readest")
    }
    fn loading_status(&self) -> &str {
        self.loading_status.as_deref().unwrap_or("Loading article…")
    }
    fn capturing_status(&self) -> &str {
        self.capturing_status
            .as_deref()
            .unwrap_or("Capturing article…")
    }
    fn saved_title(&self) -> &str {
        self.saved_title.as_deref().unwrap_or("Saved to Readest")
    }
    fn background(&self) -> &str {
        self.background.as_deref().unwrap_or("#1f2024")
    }
    fn foreground(&self) -> &str {
        self.foreground.as_deref().unwrap_or("#f5f5f7")
    }
}

/// Parse a `#rrggbb` colour string into 8-bit RGB components. Returns
/// `None` for any malformed input — the caller falls back to whatever
/// default it had.
fn parse_hex_color(s: &str) -> Option<(u8, u8, u8)> {
    let hex = s.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

/// HTML-escape a translated string before inlining it into the bridge
/// page or the loading overlay's static markup. JS string literals use
/// `serde_json::to_string` (which already escapes correctly for JS).
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Monotonic + nanosecond timestamp token — unique enough; the token is
/// not a security boundary on its own (the listener only binds to
/// 127.0.0.1 and we close it after the first valid POST), but it makes
/// the URL path predictable for debugging and prevents a rogue process
/// on the loopback interface from accidentally hitting us.
#[cfg(desktop)]
fn next_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}{:x}", ts, n)
}

// The request URL now carries the page HTML as base64, so the request
// LINE alone can be megabytes — bump generously.
#[cfg(desktop)]
const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;
#[cfg(desktop)]
const READ_CHUNK_BYTES: usize = 64 * 1024;
#[cfg(desktop)]
const SOCKET_TIMEOUT: Duration = Duration::from_secs(10);

/// Find the `\r\n\r\n` that terminates the HTTP request headers.
#[cfg(desktop)]
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Pull `Content-Length` out of header bytes (case-insensitive).
#[cfg(desktop)]
fn parse_content_length(headers: &str) -> usize {
    for line in headers.split("\r\n").skip(1) {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                return value.trim().parse().unwrap_or(0);
            }
        }
    }
    0
}

/// Capture loop. The clip webview navigates to
/// `GET /clip/{token}?d={base64-HTML}` — top-level navigation isn't
/// governed by CSP `connect-src` / `form-action`, and the URL itself
/// carries the data (so we don't need any cross-origin storage trick).
/// Server decodes the base64, signals the oneshot, returns a tiny
/// "captured" page so the user can see the round-trip worked.
#[cfg(desktop)]
async fn capture_one(
    listener: TcpListener,
    token: String,
    tx: oneshot::Sender<String>,
    saved_title: String,
    background: String,
    foreground: String,
) {
    let mut tx = Some(tx);
    let expected_prefix = format!("/clip/{}", token);
    let saved_title_safe = escape_html(&saved_title);
    // CSS-context escape: the caller-provided colour goes into a
    // `style="…"` attribute. Reuse the HTML escape so any quote /
    // angle-bracket can't break out of the attribute or smuggle markup.
    let bg_css = escape_html(&background);
    let fg_css = escape_html(&foreground);
    loop {
        let Ok((mut stream, _peer)) = listener.accept().await else {
            break;
        };

        let mut buf = Vec::with_capacity(READ_CHUNK_BYTES);
        let mut chunk = vec![0u8; READ_CHUNK_BYTES];
        let mut header_end: Option<usize> = None;
        let mut content_length: usize = 0;

        loop {
            if buf.len() > MAX_REQUEST_BYTES {
                break;
            }
            let read = tokio::time::timeout(SOCKET_TIMEOUT, stream.read(&mut chunk)).await;
            let n = match read {
                Ok(Ok(n)) if n > 0 => n,
                _ => break,
            };
            buf.extend_from_slice(&chunk[..n]);
            if header_end.is_none() {
                if let Some(idx) = find_header_end(&buf) {
                    header_end = Some(idx);
                    let headers_str = std::str::from_utf8(&buf[..idx]).unwrap_or("");
                    content_length = parse_content_length(headers_str);
                }
            }
            if let Some(idx) = header_end {
                if buf.len() >= idx + 4 + content_length {
                    break;
                }
            }
        }

        let Some(hdr_end) = header_end else {
            continue;
        };
        let headers_str = std::str::from_utf8(&buf[..hdr_end]).unwrap_or("");
        let first_line = headers_str.lines().next().unwrap_or("");
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("");

        // `target` is the request-target — `/clip/{token}?d=...`. Split
        // path vs query.
        let (path, query) = match target.find('?') {
            Some(i) => (&target[..i], &target[i + 1..]),
            None => (target, ""),
        };

        if method != "GET" || path != expected_prefix {
            let _ = stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .await;
            continue;
        }

        // Decode `d=<base64>` out of the query string.
        let mut data_b64: Option<&str> = None;
        for pair in query.split('&') {
            if let Some(v) = pair.strip_prefix("d=") {
                data_b64 = Some(v);
                break;
            }
        }
        let html = match data_b64.and_then(decode_b64) {
            Some(s) => s,
            None => {
                let body = b"capture: missing or invalid `d` query param";
                let mut response = Vec::with_capacity(128 + body.len());
                response.extend_from_slice(b"HTTP/1.1 400 Bad Request\r\n");
                response.extend_from_slice(b"Content-Type: text/plain; charset=utf-8\r\n");
                response.extend_from_slice(
                    format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes(),
                );
                response.extend_from_slice(body);
                let _ = stream.write_all(&response).await;
                continue;
            }
        };

        // Tell the user / devtools the round-trip succeeded with the
        // same look as the loading overlay — same dark background,
        // checkmark instead of spinner. Window closes a moment later.
        let confirmation = format!(
            r##"<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;height:100vh;background:{bg};color:{fg};
font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
padding:24px;box-sizing:border-box;text-align:center">
<div style="width:36px;height:36px;border-radius:50%;background:rgba(76,175,80,0.18);
display:flex;align-items:center;justify-content:center">
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7cd47e"
stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
</div>
<div style="font-size:15px;font-weight:600">{title}</div>
</body></html>"##,
            title = saved_title_safe,
            bg = bg_css,
            fg = fg_css,
        );
        // bytes count was diagnostic-only; dropped from the user-facing
        // page so the captured-state stays clean across locales.
        let _ = html.len();
        let mut response = Vec::with_capacity(256 + confirmation.len());
        response.extend_from_slice(b"HTTP/1.1 200 OK\r\n");
        response.extend_from_slice(b"Content-Type: text/html; charset=utf-8\r\n");
        response.extend_from_slice(
            format!("Content-Length: {}\r\n\r\n", confirmation.len()).as_bytes(),
        );
        response.extend_from_slice(confirmation.as_bytes());
        let _ = stream.write_all(&response).await;

        if let Some(tx) = tx.take() {
            let _ = tx.send(html);
        }
        break;
    }
}

/// Decode a URL-safe base64 string (the JS side uses `btoa` which
/// produces standard base64; we also accept URL-safe variants in case
/// a future caller swaps). Returns the decoded UTF-8 string, or None
/// on any decode error.
#[cfg(desktop)]
fn decode_b64(s: &str) -> Option<String> {
    use std::collections::HashMap;
    // Tiny hand-rolled base64 decoder — avoids pulling in another
    // crate for one place. Accepts standard + URL-safe alphabets and
    // ignores any non-alphabet character (so `+`/`/` URL-encoded as
    // `%2B`/`%2F` would slip through, but we've not URL-encoded the
    // body, just escaped it via toString).
    static ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_";
    let table: HashMap<u8, u8> = ALPHABET
        .bytes()
        .enumerate()
        .map(|(i, b)| {
            let value = match b {
                b'-' => 62,
                b'_' => 63,
                _ => i as u8,
            };
            (b, value)
        })
        .collect();

    let mut bytes = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        let v = match table.get(&c) {
            Some(&v) => v as u32,
            None => continue, // skip whitespace / unexpected chars
        };
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((acc >> bits) as u8);
            acc &= (1u32 << bits) - 1;
        }
    }
    String::from_utf8(bytes).ok()
}

/// Inject a fullscreen loading overlay before the page renders so the
/// user sees a deliberate "Saving…" UI instead of the article flashing
/// by. The overlay is `position:fixed` with the maximum z-index and
/// re-attaches itself for a few hundred milliseconds in case the page's
/// hydration step wipes our node. It's just chrome — the page
/// underneath still loads, runs scripts, and fires its lazy-loaders.
#[cfg(desktop)]
fn loading_overlay_script(
    overlay_title: &str,
    loading_status: &str,
    background: &str,
    foreground: &str,
) -> String {
    // Inline as JS string literals (JSON encoding handles the escapes).
    // `textContent` assignment avoids any HTML injection risk from the
    // translated strings themselves; JSON-encoding the colour values
    // makes any unexpected character (a stray quote, a CSS expression)
    // a syntax error rather than a CSS injection.
    let title_json = serde_json::to_string(overlay_title).unwrap_or_else(|_| "\"\"".into());
    let status_json = serde_json::to_string(loading_status).unwrap_or_else(|_| "\"\"".into());
    let bg_json = serde_json::to_string(background).unwrap_or_else(|_| "\"#1f2024\"".into());
    let fg_json = serde_json::to_string(foreground).unwrap_or_else(|_| "\"#f5f5f7\"".into());
    format!(
        r#"
        (function() {{
          var TITLE = {title_json};
          var STATUS = {status_json};
          var BG = {bg_json};
          var FG = {fg_json};
          function install() {{
            if (document.getElementById('__readest_overlay__')) return;
            if (!document.documentElement) return;
            var ov = document.createElement('div');
            ov.id = '__readest_overlay__';
            ov.setAttribute('aria-live', 'polite');
            ov.style.cssText = [
              'position:fixed','inset:0',
              'background:' + BG,'color:' + FG,
              'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
              'display:flex','flex-direction:column','align-items:center','justify-content:center',
              'gap:14px','padding:24px','box-sizing:border-box','text-align:center',
              'z-index:2147483647','pointer-events:auto'
            ].join(';');
            var spin = document.createElement('div');
            // Spinner uses the foreground colour with low/high opacity so it
            // reads on both light and dark themes.
            spin.style.cssText = 'width:36px;height:36px;border:3px solid color-mix(in srgb,' +
              ' ' + FG + ' 18%, transparent);' +
              'border-top-color:color-mix(in srgb,' + FG + ' 85%, transparent);' +
              'border-radius:50%;animation:__readest_spin__ 0.8s linear infinite';
            var title = document.createElement('div');
            title.style.cssText = 'font-size:15px;font-weight:600';
            title.textContent = TITLE;
            var status = document.createElement('div');
            status.id = '__readest_status__';
            status.style.cssText = 'font-size:13px;opacity:0.7;max-width:340px;' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            status.textContent = STATUS;
            var style = document.createElement('style');
            style.textContent = '@keyframes __readest_spin__{{to{{transform:rotate(360deg)}}}}';
            ov.appendChild(spin);
            ov.appendChild(title);
            ov.appendChild(status);
            ov.appendChild(style);
            document.documentElement.appendChild(ov);
          }}
          install();
          var attempts = 0;
          var iv = setInterval(function() {{
            attempts++;
            if (attempts > 30 || document.readyState === 'complete') {{
              install();
              clearInterval(iv);
              return;
            }}
            install();
          }}, 200);
          window.__readest_setStatus__ = function(text) {{
            var el = document.getElementById('__readest_status__');
            if (el) el.textContent = text;
          }};
        }})();
        "#,
    )
}

/// Hide the usual headless-/automation-flavoured signals before the page's
/// own scripts run. The mask doesn't try to be exhaustive — sites with
/// commercial bot detection (X.com, sophisticated paywalls) will still
/// catch us through canvas / WebGL / audio fingerprinting. The goal is
/// just to clear the "you look like Chrome but `navigator.webdriver` is
/// set" tier of checks.
#[cfg(desktop)]
fn fingerprint_mask_script() -> String {
    r#"
    (function() {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch (e) {}
      try {
        // Many Chrome-only objects sites probe for.
        if (!window.chrome) {
          window.chrome = { runtime: {} };
        }
      } catch (e) {}
      try {
        // navigator.languages — some checks see an empty list as suspicious.
        if (navigator.languages && navigator.languages.length === 0) {
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        }
      } catch (e) {}
    })();
    "#
    .to_string()
}

/// Spawn a hidden webview, load `url`, wait for the rendered HTML, return
/// it. Errors:
/// - "Invalid URL" / "URL must use http or https" — pre-flight validation.
/// - "Could not bind capture port: …" — local listener bind failed.
/// - "Could not create clip webview: …" — Tauri couldn't open the window.
/// - "Page took too long to load" — 30 s timeout elapsed without a POST.
/// - "Webview closed before capture" — the page closed itself, or our
///   `close()` raced the script.
#[cfg(desktop)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("URL must use http or https".into());
    }

    let options = options.unwrap_or_default();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Could not bind capture port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Could not read capture port: {}", e))?
        .port();

    let token = next_token();
    let (tx, rx) = oneshot::channel::<String>();
    let token_for_server = token.clone();
    let saved_title_for_server = options.saved_title().to_string();
    let bg_for_server = options.background().to_string();
    let fg_for_server = options.foreground().to_string();
    tokio::spawn(async move {
        capture_one(
            listener,
            token_for_server,
            tx,
            saved_title_for_server,
            bg_for_server,
            fg_for_server,
        )
        .await;
    });

    let label = format!("clip-{}", token);
    let token_json = serde_json::to_string(&token).map_err(|e| e.to_string())?;
    let capturing_status_json =
        serde_json::to_string(options.capturing_status()).map_err(|e| e.to_string())?;
    let init_script = format!(
        r#"
        (function() {{
          console.log('[readest-clip] init script running');
          var PORT = {port};
          var TOKEN = {token_json};
          var CAPTURING_STATUS = {capturing_status_json};
          var TARGET = 'http://127.0.0.1:' + PORT + '/clip/' + TOKEN;
          var sent = false;
          function send(reason) {{
            if (sent) return;
            sent = true;
            try {{
              if (window.__readest_setStatus__) {{
                window.__readest_setStatus__(CAPTURING_STATUS);
              }}
              var html = document.documentElement.outerHTML;
              console.log('[readest-clip] capturing reason=' + reason +
                ' bytes=' + html.length);
              // Transfer the HTML through the navigation URL itself —
              // top-level navigation isn't governed by CSP `connect-src`
              // / `form-action`, and WebKit doesn't enforce Private
              // Network Access on navigation the way it does on fetch.
              // Each earlier transport was blocked by something:
              //   - fetch / XHR        : connect-src + WebKit PNA mixed-content
              //   - <form action=...>  : CSP form-action
              //   - custom URI scheme  : WebKit insecure-content
              //   - window.name + nav  : WebKit clears name on x-origin nav
              // unescape(encodeURIComponent(...)) is the canonical
              // UTF-8 dance before btoa(), which otherwise throws on
              // multi-byte chars (every CJK article).
              // URL-safe base64 — replace +/= so the browser doesn't
              // percent-encode them and the Rust decoder doesn't have to
              // un-encode. Padding stripped.
              var b64 = btoa(unescape(encodeURIComponent(html)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
              var sep = TARGET.indexOf('?') >= 0 ? '&' : '?';
              window.location.assign(TARGET + sep + 'd=' + b64);
            }} catch (e) {{
              console.warn('[readest-clip] navigate threw:', e && e.message);
            }}
          }}
          // Capture after the load event + a generous settle so JS
          // challenges resolve and IntersectionObserver-based lazy
          // loaders fire for content already in the viewport. We used
          // to scroll top→bottom to force every lazy image to load,
          // but in practice modern sites use a roomy rootMargin and
          // most images on the page have already started loading by
          // the time we hit this point.
          window.addEventListener('load', function() {{
            setTimeout(function() {{ send('load+settle'); }}, 3000);
          }}, {{ once: true }});
          // Hard fallback in case `load` never fires (SPA, error state,
          // long-running redirect chain).
          setTimeout(function() {{ send('hard-timeout'); }}, 20000);
        }})();
        "#,
    );

    // Send a real Chrome UA. Tauri's default UA reports Safari on macOS
    // and Edge/WebView2 on Windows; sites with aggressive bot detection
    // (X / Twitter, some news sites) cross-check the UA against
    // navigator.* fingerprints and reject the mismatch.
    const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                              (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    // macOS doesn't honour `.visible(false)` for a WKWebView that needs
    // its JS timers to keep firing — the public Tauri API can't reach
    // the private NSWindow flags that would hide it without freezing
    // scripts. The window IS going to be on screen briefly. Match the
    // chrome style Readest's main/reader windows use so it doesn't read
    // as a foreign popup: on macOS the standard window frame with an
    // overlay (transparent) title bar; on other desktops, decorationless
    // with a drop shadow. The loading overlay (injected via initialization
    // script) covers the article render so the user sees a deliberate
    // "Saving…" state rather than the article flashing by.
    let win_builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(options.window_title())
        .visible(true)
        .center()
        .resizable(false)
        .inner_size(640.0, 480.0)
        .user_agent(BROWSER_UA)
        .initialization_script(fingerprint_mask_script())
        .initialization_script(loading_overlay_script(
            options.overlay_title(),
            options.loading_status(),
            options.background(),
            options.foreground(),
        ))
        .initialization_script(&init_script);

    // Tint the window's native background to the caller's theme `bg` so
    // the brief flash before the loading overlay attaches (and any sliver
    // around the WKWebView during resize/inset adjustments) matches the
    // main window's palette instead of flashing white.
    let win_builder = if let Some((r, g, b)) = parse_hex_color(options.background()) {
        win_builder.background_color(tauri::window::Color(r, g, b, 255))
    } else {
        win_builder
    };

    #[cfg(target_os = "macos")]
    let win_builder = win_builder
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay);

    #[cfg(all(not(target_os = "macos"), desktop))]
    let win_builder = win_builder.decorations(false).shadow(true);

    let webview_result = win_builder.build();

    let webview = match webview_result {
        Ok(w) => w,
        Err(e) => return Err(format!("Could not create clip webview: {}", e)),
    };

    // 30 s covers a slow page load and a Cloudflare-style JS challenge
    // (5–15 s on bad networks) with margin for the settle delay.
    let result = tokio::time::timeout(Duration::from_secs(30), rx).await;

    // Always close the clip window after capture (or timeout) — the
    // window flashing on screen for a few seconds is the brief mode
    // we want, not a lingering "Saving…" window the user has to close
    // themselves.
    let _ = webview.close();

    match result {
        Ok(Ok(html)) => Ok(html),
        Ok(Err(_)) => Err("Webview closed before capture".into()),
        Err(_) => Err("Page took too long to load".into()),
    }
}

/// Mobile clip path. iOS / Android can't spawn a separate
/// `WebviewWindow` and have no equivalent localhost-listener escape
/// hatch, so we hand the URL off to the native-bridge plugin which
/// presents a full-screen `WKWebView` / `WebView`, runs the same Chrome-
/// UA / fingerprint-mask / loading-overlay shape as the desktop flow,
/// captures `document.documentElement.outerHTML` via the platform's
/// `evaluateJavaScript`, and returns it back through the Tauri IPC.
///
/// The JS surface stays identical: `invoke('clip_url', { url, options })`
/// returns the rendered HTML on both desktop and mobile.
#[cfg(mobile)]
#[tauri::command]
pub async fn clip_url(
    app: AppHandle,
    url: String,
    options: Option<ClipOptions>,
) -> Result<String, String> {
    use tauri_plugin_native_bridge::{ClipUrlRequest, NativeBridgeExt};

    let options = options.unwrap_or_default();
    let request = ClipUrlRequest {
        url,
        window_title: options.window_title,
        overlay_title: options.overlay_title,
        loading_status: options.loading_status,
        capturing_status: options.capturing_status,
        saved_title: options.saved_title,
        background: options.background,
        foreground: options.foreground,
    };
    app.native_bridge()
        .clip_url(request)
        .map(|r| r.html)
        .map_err(|e| e.to_string())
}
