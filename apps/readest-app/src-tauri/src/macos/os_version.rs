//! macOS OS-version detection for the Tahoe close-to-hide workaround.
//!
//! macOS 26 (Tahoe) regressed `NSWindow` ordering so that `orderOut:` —
//! which Tauri's `WebviewWindow::hide()` maps to — can leave a focused
//! black phantom window on screen instead of hiding it. See issue #4875.
//! On Tahoe we minimize the window instead, a different AppKit path that
//! still keeps the app in the dock and preserves the open book.

use objc::{class, msg_send, sel, sel_impl};

/// Returns true when `major` is macOS Tahoe (26) or later.
pub(crate) fn is_tahoe_or_later(major: i64) -> bool {
    major >= 26
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

/// True when running on macOS Tahoe (26) or later.
pub fn is_macos_tahoe_or_later() -> bool {
    is_tahoe_or_later(macos_major_version())
}

#[cfg(test)]
mod tests {
    use super::is_tahoe_or_later;

    #[test]
    fn detects_tahoe_and_later() {
        assert!(is_tahoe_or_later(26)); // Tahoe
        assert!(is_tahoe_or_later(27));
    }

    #[test]
    fn rejects_pre_tahoe() {
        assert!(!is_tahoe_or_later(25)); // Sequoia
        assert!(!is_tahoe_or_later(15)); // older numbering
    }
}
