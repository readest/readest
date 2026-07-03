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

/// Sentry `environment` for the current build.
pub fn sentry_environment() -> &'static str {
    environment_for_version(env!("CARGO_PKG_VERSION"))
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
    use super::{dsn_from_env, environment_for_version};

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
}
