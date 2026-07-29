//! WebView engine/version tracking for the app's own diagnostics.
//!
//! The frontend reports `navigator.userAgent` once at startup (see
//! `NativeAppService.init()` -> `set_webview_info`); the parsed engine/version
//! is stored here for any consumer that needs it. Sentry crash reporting was
//! removed for fork builds, so this module no longer feeds crash events.

static WEBVIEW_INFO: std::sync::OnceLock<(String, String)> = std::sync::OnceLock::new();

/// Record the WebView engine + version. No-op if already set.
pub fn set_webview_info(engine: String, version: String) {
    let _ = WEBVIEW_INFO.set((engine, version));
}

/// The recorded WebView `(engine, version)`, if the app has reported it yet.
pub fn webview_info() -> Option<&'static (String, String)> {
    WEBVIEW_INFO.get()
}

/// Parse the WebView engine and major version from a User-Agent string. Chromium
/// WebViews (Android System WebView, Windows WebView2, Linux Chrome) carry a
/// `Chrome/<v>` token; WebKit ones (iOS/macOS WKWebView, Linux WebKitGTK) carry
/// `Version/<v>` and no `Chrome/`. Chrome is checked first because Android
/// WebViews also include a legacy `Version/4.0`. `None` if neither is present.
pub fn parse_webview_info(user_agent: &str) -> Option<(String, String)> {
    if let Some(v) = ua_major_version(user_agent, "Chrome/") {
        return Some(("Chromium".to_string(), v));
    }
    if let Some(v) = ua_major_version(user_agent, "Version/") {
        return Some(("WebKit".to_string(), v));
    }
    None
}

fn ua_major_version(user_agent: &str, token: &str) -> Option<String> {
    let rest = &user_agent[user_agent.find(token)? + token.len()..];
    let major: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if major.is_empty() {
        None
    } else {
        Some(major)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_webview_info;

    #[test]
    fn parses_chromium_webview_version() {
        // Android System WebView carries a legacy `Version/4.0` AND `Chrome/140`;
        // Chrome must win.
        let ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) \
                  Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36";
        assert_eq!(
            parse_webview_info(ua),
            Some(("Chromium".to_string(), "140".to_string()))
        );
    }

    #[test]
    fn parses_webkit_webview_version() {
        let ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) \
                   AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
        assert_eq!(
            parse_webview_info(ios),
            Some(("WebKit".to_string(), "17".to_string()))
        );
        let gtk = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) \
                   Version/2.44.0 Safari/605.1.15";
        assert_eq!(
            parse_webview_info(gtk),
            Some(("WebKit".to_string(), "2".to_string()))
        );
    }

    #[test]
    fn webview_info_is_none_for_unrecognized_ua() {
        assert_eq!(parse_webview_info("curl/8.0"), None);
        assert_eq!(parse_webview_info(""), None);
    }
}
