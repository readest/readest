use std::sync::OnceLock;

use crate::eink_identity::is_eink_identity;

/// Read a raw Android system property (`ro.*`) as a UTF-8 string, if present.
fn get_system_property(prop: &str) -> Option<String> {
    use std::ffi::CString;
    let name = CString::new(prop).ok()?;
    let mut buf = [0u8; libc::PROP_VALUE_MAX as usize];
    // SAFETY: __system_property_get writes at most PROP_VALUE_MAX bytes (including the
    // trailing NUL) into the provided buffer and returns the number of bytes written
    // excluding the NUL. `name` is a valid NUL-terminated C string for the duration
    // of the call.
    let len = unsafe {
        libc::__system_property_get(name.as_ptr(), buf.as_mut_ptr() as *mut libc::c_char)
    };
    if len <= 0 {
        return None;
    }
    let value = std::str::from_utf8(&buf[..len as usize]).ok()?;
    (!value.is_empty()).then(|| value.to_owned())
}

/// Check if the current Android device is an e-ink device.
///
/// The result is cached on first call so subsequent calls are free.
pub fn is_eink_device() -> bool {
    static IS_EINK: OnceLock<bool> = OnceLock::new();
    *IS_EINK.get_or_init(detect_eink_device)
}

/// Probe the device identity properties and e-ink specific properties once.
fn detect_eink_device() -> bool {
    let lower = |prop: &str| get_system_property(prop).unwrap_or_default().to_lowercase();
    let manufacturer = lower("ro.product.manufacturer");
    let brand = lower("ro.product.brand");
    let model = lower("ro.product.model");
    let device = lower("ro.product.device");

    if is_eink_identity(&manufacturer, &brand, &model, &device) {
        return true;
    }

    // Check for e-ink specific system properties
    if let Some(eink_support) = get_system_property("ro.eink.support") {
        if eink_support == "1" || eink_support.to_lowercase() == "true" {
            return true;
        }
    }

    // Check for BOOX specific property
    if get_system_property("ro.onyx.devicename").is_some() {
        return true;
    }

    false
}
