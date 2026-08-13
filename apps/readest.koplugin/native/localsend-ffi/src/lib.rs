//! C ABI for KOReader's LuaJIT FFI. Poll-based: LuaJIT forbids callbacks
//! from foreign threads, so every function is non-blocking (ls_start binds
//! sockets synchronously but returns immediately after) and Lua drains the
//! event queue on a UI timer. Every `char*` returned by `ls_status` and
//! `ls_poll_event` is malloc'd by Rust and MUST be released with
//! `ls_string_free`. The exception is `ls_version`, whose return value is a
//! static string owned by the library for its whole lifetime and must never
//! be freed.

mod config;
mod events;
mod identity;
mod service;

use config::StartConfig;
use serde::Serialize;
use std::ffi::{c_char, c_int, CStr, CString};
use std::panic::catch_unwind;
use std::sync::{Mutex, PoisonError};

pub const OK: c_int = 0;
pub const ERR_ARG: c_int = -1;
pub const ERR_STATE: c_int = -2;
pub const ERR_START: c_int = -3;
pub const ERR_PANIC: c_int = -100;

/// Bump when the exported ABI changes; Lua refuses a mismatched lib.
const ABI_VERSION: &CStr = c"1";

struct Running {
    rt: tokio::runtime::Runtime,
    service: service::Service,
}

static STATE: Mutex<Option<Running>> = Mutex::new(None);

fn state() -> std::sync::MutexGuard<'static, Option<Running>> {
    STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

fn cstr_arg<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr) }.to_str().ok()
}

fn to_owned_cstring(s: String) -> *mut c_char {
    CString::new(s)
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn ls_version() -> *const c_char {
    ABI_VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn ls_start(config_json: *const c_char) -> c_int {
    catch_unwind(|| {
        let Some(json) = cstr_arg(config_json) else {
            return ERR_ARG;
        };
        let config = match StartConfig::parse(json) {
            Ok(config) => config,
            Err(err) => {
                events::push(&events::Event::Error {
                    message: format!("bad config: {err}"),
                });
                return ERR_ARG;
            }
        };
        let mut guard = state();
        if guard.is_some() {
            return OK; // idempotent: context switches re-attach, not restart
        }
        events::clear();
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(err) => {
                events::push(&events::Event::Error {
                    message: format!("runtime: {err}"),
                });
                return ERR_START;
            }
        };
        match rt.block_on(service::start(config)) {
            Ok(svc) => {
                *guard = Some(Running { rt, service: svc });
                OK
            }
            Err(err) => {
                events::push(&events::Event::Error { message: err });
                rt.shutdown_background();
                ERR_START
            }
        }
    })
    .unwrap_or(ERR_PANIC)
}

#[no_mangle]
pub extern "C" fn ls_stop() -> c_int {
    catch_unwind(|| {
        let Some(mut running) = state().take() else {
            return OK;
        };
        running.rt.block_on(service::stop(&mut running.service));
        running
            .rt
            .shutdown_timeout(std::time::Duration::from_secs(2));
        OK
    })
    .unwrap_or(ERR_PANIC)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    running: bool,
    alias: Option<String>,
    port: Option<u16>,
    local_ips: Vec<String>,
    multicast_error: Option<String>,
}

#[no_mangle]
pub extern "C" fn ls_status() -> *mut c_char {
    catch_unwind(|| {
        let guard = state();
        let status = match guard.as_ref() {
            Some(running) => Status {
                running: true,
                alias: Some(running.service.alias.clone()),
                port: Some(running.service.port),
                local_ips: service::local_ips(),
                multicast_error: running.service.multicast_error.clone(),
            },
            None => Status {
                running: false,
                alias: None,
                port: None,
                local_ips: Vec::new(),
                multicast_error: None,
            },
        };
        to_owned_cstring(serde_json::to_string(&status).unwrap_or_else(|_| "{}".into()))
    })
    .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn ls_poll_event() -> *mut c_char {
    catch_unwind(|| match events::pop() {
        Some(json) => to_owned_cstring(json),
        None => std::ptr::null_mut(),
    })
    .unwrap_or(std::ptr::null_mut())
}

fn respond(session_id: *const c_char, accept: bool) -> c_int {
    catch_unwind(|| {
        let Some(id) = cstr_arg(session_id) else {
            return ERR_ARG;
        };
        let guard = state();
        let Some(running) = guard.as_ref() else {
            return ERR_STATE;
        };
        let ok = if accept {
            service::accept(&running.service, id)
        } else {
            service::decline(&running.service, id)
        };
        if ok {
            OK
        } else {
            ERR_STATE
        }
    })
    .unwrap_or(ERR_PANIC)
}

#[no_mangle]
pub extern "C" fn ls_accept(session_id: *const c_char) -> c_int {
    respond(session_id, true)
}

#[no_mangle]
pub extern "C" fn ls_decline(session_id: *const c_char) -> c_int {
    respond(session_id, false)
}

/// # Safety
/// `s` must be null or a pointer previously returned by `ls_status` or
/// `ls_poll_event`, and must not be freed more than once. Never pass the
/// pointer returned by `ls_version` here: it is a static string, not a
/// Rust-owned allocation, and freeing it is undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn ls_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{CStr, CString};

    // The event queue and STATE are process-global; TEST_QUEUE_GUARD
    // serializes this test against every other test in the crate that
    // touches EVENTS (see events::tests::event_queue_contract), so parallel
    // test threads can't interleave their clear/push/pop calls.
    #[test]
    fn ffi_surface_contract() {
        let _guard = events::TEST_QUEUE_GUARD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        // ABI version
        let v = unsafe { CStr::from_ptr(ls_version()) };
        assert_eq!(v.to_str().unwrap(), "1");

        // Null / invalid args
        assert_eq!(ls_start(std::ptr::null()), ERR_ARG);
        assert_eq!(ls_accept(std::ptr::null()), ERR_ARG);
        crate::events::clear();
        let bad = CString::new("{not json").unwrap();
        assert_eq!(ls_start(bad.as_ptr()), ERR_ARG);
        let ev = crate::events::pop().expect("error event queued");
        assert!(ev.contains(r#""type":"error""#), "{ev}");

        // Not running: status says so, accept/decline refuse, stop is a no-op
        let sid = CString::new("nope").unwrap();
        assert_eq!(ls_accept(sid.as_ptr()), ERR_STATE);
        assert_eq!(ls_decline(sid.as_ptr()), ERR_STATE);
        assert_eq!(ls_stop(), OK);
        let status_ptr = ls_status();
        let status = unsafe { CStr::from_ptr(status_ptr) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { ls_string_free(status_ptr) };
        assert!(status.contains(r#""running":false"#), "{status}");

        // Poll on empty queue is NULL
        crate::events::clear();
        assert!(ls_poll_event().is_null());
    }
}
