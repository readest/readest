//! Binds real ports and the multicast group. Run manually:
//!   cargo test --test smoke -- --ignored --nocapture

use std::ffi::{CStr, CString};

#[test]
#[ignore = "binds real ports; run manually"]
fn starts_polls_started_event_and_stops() {
    let base = std::env::temp_dir().join(format!("lsffi-smoke-{}", std::process::id()));
    let cfg = serde_json::json!({
        "alias": "smoke-test",
        "deviceModel": "KOReader",
        "deviceType": "mobile",
        "dataDir": base.join("data").to_string_lossy(),
        "downloadDir": base.join("dl").to_string_lossy(),
    })
    .to_string();
    let cfg = CString::new(cfg).unwrap();
    assert_eq!(localsend_ffi::ls_start(cfg.as_ptr()), localsend_ffi::OK);

    let mut started = false;
    for _ in 0..50 {
        let ptr = localsend_ffi::ls_poll_event();
        if !ptr.is_null() {
            let ev = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
            unsafe { localsend_ffi::ls_string_free(ptr) };
            println!("event: {ev}");
            if ev.contains(r#""type":"started""#) {
                started = true;
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    assert!(started, "no started event within 5s");

    let ptr = localsend_ffi::ls_status();
    let status = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
    unsafe { localsend_ffi::ls_string_free(ptr) };
    assert!(status.contains(r#""running":true"#), "{status}");

    // Idempotency: starting again while already running re-attaches instead
    // of restarting, and must still report OK and still-running.
    assert_eq!(localsend_ffi::ls_start(cfg.as_ptr()), localsend_ffi::OK);
    let ptr = localsend_ffi::ls_status();
    let status = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
    unsafe { localsend_ffi::ls_string_free(ptr) };
    assert!(status.contains(r#""running":true"#), "{status}");

    assert_eq!(localsend_ffi::ls_stop(), localsend_ffi::OK);

    // Idempotency: stopping again once already stopped is a no-op, not an
    // error.
    assert_eq!(localsend_ffi::ls_stop(), localsend_ffi::OK);

    let _ = std::fs::remove_dir_all(&base);
}
