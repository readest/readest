//! Pure helpers for configuring Sentry. Kept dependency-free and unit-tested;
//! the actual `sentry::init` call and plugin registration live in `lib.rs`.

/// Normalizes a raw `SENTRY_DSN` value. Unset, empty, or whitespace-only maps to
/// `None` so local and fork builds (no DSN) never report.
pub fn dsn_from_env(raw: Option<&str>) -> Option<&str> {
    match raw {
        Some(dsn) if !dsn.trim().is_empty() => Some(dsn.trim()),
        _ => None,
    }
}

/// Compile-time Sentry DSN from the `SENTRY_DSN` env var (baked at build time).
pub fn sentry_dsn() -> Option<&'static str> {
    dsn_from_env(option_env!("SENTRY_DSN"))
}

/// Sentry `environment` tag derived from the crate version. Nightly builds use a
/// single 10-digit `YYYYMMDDHH` prerelease (e.g. `0.11.17-2026070301`);
/// everything else is treated as production.
pub fn environment_for_version(version: &str) -> &'static str {
    if let Some((_, pre)) = version.split_once('-') {
        if pre.len() == 10 && pre.bytes().all(|b| b.is_ascii_digit()) {
            return "nightly";
        }
    }
    "production"
}

/// The user-facing application version, taken from `package.json` at build time
/// (baked as `READEST_APP_VERSION` by `build.rs`). Falls back to the crate version
/// only if the bake is missing. The crate version (`Cargo.toml`, e.g. `0.2.2`) is
/// not kept in lockstep with the app, so Sentry must key its release and
/// environment off the app version instead of `CARGO_PKG_VERSION`.
pub fn app_version() -> &'static str {
    option_env!("READEST_APP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

/// Joins a crate name and version into Sentry's `name@version` release format
/// (e.g. `Readest@0.11.17`), matching `sentry::release_name!()`'s shape.
pub fn release_name(name: &str, version: &str) -> String {
    format!("{name}@{version}")
}

/// Sentry `release` for the current build, keyed off the app version.
pub fn sentry_release() -> String {
    release_name(env!("CARGO_PKG_NAME"), app_version())
}

/// Sentry `environment` for the current build.
pub fn sentry_environment() -> &'static str {
    environment_for_version(app_version())
}

/// The Rust SDK's context integration derives the OS name from `uname()`, which
/// reports "Linux" on Android (Android runs a Linux kernel). Given the build's
/// `target_os` and the already-detected name, return the name Sentry should show,
/// or `None` to leave it unchanged. Only Android is remapped; the native
/// sentry-android/-cocoa SDKs report other platforms correctly on their own.
pub fn corrected_os_name(target_os: &str, detected: Option<&str>) -> Option<&'static str> {
    (target_os == "android" && detected != Some("Android")).then_some("Android")
}

/// Extracts the Android platform version from `uname`'s kernel release string
/// (e.g. `6.1.162-android14-11-g5e8b0cffebd1-ab15202165` -> `"14"`). `uname`
/// reports the Linux kernel version, not the Android version, but Android kernels
/// embed an `android<N>` token. Returns `None` when no such token is present.
pub fn android_version_from_uname(release: &str) -> Option<String> {
    let digits = release
        .split(['-', '_'])
        .find_map(|token| token.strip_prefix("android"))?;
    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        Some(digits.to_string())
    } else {
        None
    }
}

/// Known-benign browser errors that are expected behavior, not app bugs, and
/// only add noise to crash reporting:
/// - The View Transition API skips a transition when the tab is hidden or the
///   navigation is superseded, aborts it when the document is in an invalid
///   state, and times out when the DOM update overruns its ~4s budget (e.g. a
///   large library grid render on a slow device). All arrive as unhandled
///   rejections while the navigation itself still completes without the
///   animation, so none is an app bug (READEST-7 / READEST-F / READEST-G /
///   READEST-9). The timeout was previously kept for its perf signal, but on
///   supported engines it is just a slow render and only added backlog noise.
/// - "ResizeObserver loop limit exceeded" / "ResizeObserver loop completed with
///   undelivered notifications" is a benign notice the browser fires when
///   observer callbacks don't settle within one frame; the spec defines it as
///   safe to ignore and layout still converges (READEST-R / READEST-1Y /
///   READEST-26).
///
/// Matched (case-insensitively) on the exception value so they are dropped in
/// `before_send`.
pub fn is_ignored_browser_error(value: &str) -> bool {
    let value = value.to_lowercase();
    value.contains("transition was skipped")
        || value.contains("transition was aborted because of invalid state")
        || value.contains("aborted because of timeout in dom update")
        || value.contains("resizeobserver loop")
}

/// Identifies a stack-frame function belonging to the MOBI cover extraction
/// path. The third-party `mobi` crate panics on a corrupt cover record
/// (an inverted slice range) when importing a truncated file (READEST-1Q /
/// READEST-10). `mobi_parser::extract_cover` contains that panic with
/// `catch_unwind` so the import still succeeds, but Sentry's panic hook reports
/// it regardless; `before_send` drops events whose stack hits this frame so the
/// contained panic stops adding noise. Matched on our own module path (not the
/// generic slice-index message) so unrelated slice panics are still reported.
pub fn is_mobi_cover_panic_frame(function: &str) -> bool {
    function.contains("mobi_parser::extract_cover")
}

/// The WebView (engine, major-version), set once at startup when the app reports
/// its User-Agent. Stored globally so `before_send` can tag every event — the
/// browser context integration doesn't run for events forwarded from the webview.
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

/// C-ABI accessor for the compile-time Sentry DSN, used by the iOS native
/// bootstrap (sentry-cocoa) so it starts with the same DSN as the Rust client
/// without a second env read or fragile Info.plist / preprocessor plumbing.
/// Returns a NUL-terminated pointer valid for the process lifetime, or null when
/// no DSN is configured (empty `SENTRY_DSN` => the native SDK stays disabled).
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn readest_sentry_dsn() -> *const std::os::raw::c_char {
    use std::ffi::CString;
    use std::sync::OnceLock;
    static DSN: OnceLock<Option<CString>> = OnceLock::new();
    match DSN.get_or_init(|| sentry_dsn().and_then(|d| CString::new(d).ok())) {
        Some(cstr) => cstr.as_ptr(),
        None => std::ptr::null(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        android_version_from_uname, corrected_os_name, dsn_from_env, environment_for_version,
        is_ignored_browser_error, is_mobi_cover_panic_frame, parse_webview_info, release_name,
    };

    #[test]
    fn dsn_is_none_when_unset_or_blank() {
        assert_eq!(dsn_from_env(None), None);
        assert_eq!(dsn_from_env(Some("")), None);
        assert_eq!(dsn_from_env(Some("   ")), None);
    }

    #[test]
    fn dsn_is_trimmed_when_present() {
        assert_eq!(
            dsn_from_env(Some("  https://k@o.ingest.sentry.io/1  ")),
            Some("https://k@o.ingest.sentry.io/1")
        );
    }

    #[test]
    fn environment_is_nightly_for_ten_digit_prerelease() {
        assert_eq!(environment_for_version("0.11.17-2026070301"), "nightly");
    }

    #[test]
    fn environment_is_production_otherwise() {
        assert_eq!(environment_for_version("0.11.17"), "production");
        assert_eq!(environment_for_version("0.11.17-rc.1"), "production");
        assert_eq!(environment_for_version("1.0.0-2026"), "production");
    }

    #[test]
    fn release_name_joins_crate_name_and_app_version() {
        assert_eq!(release_name("Readest", "0.11.17"), "Readest@0.11.17");
    }

    #[test]
    fn os_name_is_corrected_to_android_on_android_target() {
        assert_eq!(corrected_os_name("android", Some("Linux")), Some("Android"));
        // No detected name still yields Android on an Android build.
        assert_eq!(corrected_os_name("android", None), Some("Android"));
    }

    #[test]
    fn os_name_is_left_unchanged_off_android_or_already_correct() {
        assert_eq!(corrected_os_name("android", Some("Android")), None);
        assert_eq!(corrected_os_name("linux", Some("Linux")), None);
        assert_eq!(corrected_os_name("macos", Some("macOS")), None);
        assert_eq!(corrected_os_name("windows", Some("Windows")), None);
    }

    #[test]
    fn android_version_parsed_from_kernel_release() {
        assert_eq!(
            android_version_from_uname("6.1.162-android14-11-g5e8b0cffebd1-ab15202165"),
            Some("14".to_string())
        );
        assert_eq!(
            android_version_from_uname("5.10.101-android12-9-00001"),
            Some("12".to_string())
        );
    }

    #[test]
    fn android_version_is_none_without_android_token() {
        assert_eq!(android_version_from_uname("6.1.162"), None);
        assert_eq!(android_version_from_uname(""), None);
        assert_eq!(android_version_from_uname("6.1.162-androidX"), None);
    }

    #[test]
    fn ignores_benign_view_transition_errors() {
        // Skipped because the tab is hidden (READEST-7).
        assert!(is_ignored_browser_error(
            "InvalidStateError: View transition was skipped because document visibility state is hidden."
        ));
        // Skipped because the navigation was superseded (READEST-F).
        assert!(is_ignored_browser_error(
            "AbortError: Transition was skipped"
        ));
        // Aborted because the document was in an invalid state (READEST-G).
        assert!(is_ignored_browser_error(
            "InvalidStateError: Transition was aborted because of invalid state"
        ));
        // Timed out because a slow DOM update overran the budget (READEST-9).
        assert!(is_ignored_browser_error(
            "TimeoutError: Transition was aborted because of timeout in DOM update"
        ));
    }

    #[test]
    fn matches_mobi_cover_panic_frame() {
        assert!(is_mobi_cover_panic_frame(
            "readestlib::mobi_parser::extract_cover"
        ));
        // After catch_unwind the panicking frame is the inner fn.
        assert!(is_mobi_cover_panic_frame(
            "readestlib::mobi_parser::extract_cover_inner"
        ));
    }

    #[test]
    fn keeps_unrelated_panic_frames() {
        assert!(!is_mobi_cover_panic_frame(
            "readestlib::epub_parser::extract_epub_cover_full"
        ));
        assert!(!is_mobi_cover_panic_frame(
            "core::slice::index::slice_index_fail"
        ));
        assert!(!is_mobi_cover_panic_frame(""));
    }

    #[test]
    fn ignores_resize_observer_loop_noise() {
        // Both browser phrasings are benign (READEST-R / READEST-1Y / READEST-26).
        assert!(is_ignored_browser_error(
            "ResizeObserver loop limit exceeded"
        ));
        assert!(is_ignored_browser_error(
            "Error: ResizeObserver loop completed with undelivered notifications."
        ));
    }

    #[test]
    fn keeps_real_errors() {
        assert!(!is_ignored_browser_error("TypeError: Load failed"));
        assert!(!is_ignored_browser_error("concurrent use forbidden"));
        assert!(!is_ignored_browser_error(""));
    }

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
