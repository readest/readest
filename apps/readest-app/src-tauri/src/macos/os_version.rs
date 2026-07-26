//! macOS OS-version detection for the Tahoe close-to-hide workaround.
//!
//! macOS 26 (Tahoe) regressed `NSWindow` ordering so that `orderOut:` —
//! which Tauri's `WebviewWindow::hide()` maps to — can leave a focused
//! black phantom window on screen instead of hiding it. See issue #4875.
//! The workaround is intentionally scoped to major version 26. A future
//! macOS release should use the normal AppKit path unless it is independently
//! shown to have the same regression.

use objc::{class, msg_send, sel, sel_impl};

/// Returns true when `major` is macOS Tahoe (26).
pub(crate) fn is_tahoe(major: i64) -> bool {
    major == 26
}

/// Reads the running macOS major version via `NSProcessInfo`.
fn macos_major_version() -> i64 {
    #[repr(C)]
    struct NSOperatingSystemVersion {
        major: i64,
        minor: i64,
        patch: i64,
    }

    unsafe {
        let process_info: *mut objc::runtime::Object =
            msg_send![class!(NSProcessInfo), processInfo];
        let version: NSOperatingSystemVersion = msg_send![process_info, operatingSystemVersion];
        version.major
    }
}

/// True when running on macOS Tahoe (26).
pub fn is_macos_tahoe() -> bool {
    is_tahoe(macos_major_version())
}

#[cfg(test)]
mod tests {
    use super::is_tahoe;

    #[test]
    fn detects_tahoe() {
        assert!(is_tahoe(26));
    }

    #[test]
    fn rejects_other_major_versions() {
        assert!(!is_tahoe(25));
        assert!(!is_tahoe(27));
    }
}
