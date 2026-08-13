//! C ABI for KOReader's LuaJIT FFI. Poll-based: LuaJIT forbids callbacks
//! from foreign threads, so every function is non-blocking. `ls_start`
//! validates its config synchronously (a bad config returns `ERR_ARG`
//! immediately, with an `error` event already queued) and then hands the
//! rest of the work to a dedicated OS thread that owns a tokio runtime and
//! runs `service::start`. That includes first-run RSA-2048 identity keygen,
//! which can take many seconds on a ~1 GHz e-reader CPU, so `ls_start`
//! itself always returns immediately without waiting for keygen or the
//! socket bind to finish. Lua polls `ls_status` (see the `starting` field)
//! and drains the event queue on a UI timer to learn when the service is
//! actually up. `ls_stop` is likewise non-blocking: it only signals the
//! worker thread and detaches, it does not wait for shutdown to complete.
//! Every `char*` returned by `ls_status` and `ls_poll_event` is malloc'd by
//! Rust and MUST be released with `ls_string_free`. The exception is
//! `ls_version`, whose return value is a static string owned by the library
//! for its whole lifetime and must never be freed.

mod config;
mod events;
mod identity;
mod service;

use config::StartConfig;
use serde::Serialize;
use std::ffi::{c_char, c_int, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, PoisonError};
use tokio::sync::oneshot;

pub const OK: c_int = 0;
pub const ERR_ARG: c_int = -1;
pub const ERR_STATE: c_int = -2;
pub const ERR_START: c_int = -3;
pub const ERR_PANIC: c_int = -100;

/// Bump when the exported ABI changes; Lua refuses a mismatched lib.
const ABI_VERSION: &CStr = c"1";

/// Progress of the worker thread spawned by `ls_start`, polled by
/// `ls_status`. Lives behind an `Arc` shared between that thread and every
/// FFI call, so a synchronous `ls_status`/`ls_accept`/`ls_decline` never
/// needs to touch the tokio runtime (which only the worker thread owns).
enum LiveStatus {
    /// `service::start` (identity keygen + socket bind) is still running.
    Starting,
    Running {
        alias: String,
        port: u16,
        multicast_error: Option<String>,
        // Needed by `ls_accept`/`ls_decline`, which run on the calling
        // (UI) thread and so cannot reach into the worker thread's local
        // `Service` value; both are already `Arc<Mutex<_>>` inside
        // `Service`, so cloning them out here is cheap.
        pending: service::PendingMap,
        receiving: service::ReceivingMap,
    },
    /// `service::start` returned an error; the worker thread has exited
    /// and already pushed an `error` event with the reason.
    Failed,
}

struct Running {
    /// Signals the worker thread to stop the service and exit. `ls_stop`
    /// does `state().take()` before sending, which already guarantees
    /// single consumption, so this doesn't need to be an `Option`.
    stop_tx: oneshot::Sender<()>,
    status: Arc<StdMutex<LiveStatus>>,
}

static STATE: StdMutex<Option<Running>> = StdMutex::new(None);

fn state() -> MutexGuard<'static, Option<Running>> {
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
        // A previously failed start leaves STATE occupied (LiveStatus::Failed)
        // even though its worker thread already exited: without this, the
        // idempotent re-attach check below would return OK forever and a
        // caller (e.g. Lua's onNetworkConnected retry) could never restart
        // a dead service. Clear it so this call falls through to spawn a
        // fresh worker instead.
        let stale_failed = guard.as_ref().is_some_and(|running| {
            matches!(
                *running
                    .status
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner),
                LiveStatus::Failed
            )
        });
        if stale_failed {
            *guard = None;
        }
        if guard.is_some() {
            return OK; // idempotent: context switches re-attach, not restart
        }
        // A prior worker's teardown (server/discovery stop, up to ~2s) can
        // still be in flight here if ls_stop was just called: it may still
        // push its own late events into this same queue right as we clear
        // it. Harmless (worst case a stale event Lua never sees), and not
        // worth blocking ls_start on.
        events::clear();

        let status = Arc::new(StdMutex::new(LiveStatus::Starting));
        let (stop_tx, stop_rx) = oneshot::channel::<()>();
        let worker_status = status.clone();
        // Keygen (first-run RSA-2048 self-signed cert) and the socket bind
        // happen inside `service::start`, which this thread cannot afford
        // to wait for: it's called synchronously from a LuaJIT UI callback,
        // and a multi-second stall there freezes the whole reader with no
        // repaint. Run all of it on a dedicated OS thread instead.
        //
        // `Builder::spawn` (unlike `thread::spawn`) returns a `Result`
        // instead of panicking when the OS refuses to create the thread
        // (e.g. out of memory/thread quota on a resource-starved e-reader).
        // Handle that failure explicitly: a bare `thread::spawn` here would
        // panic, get caught by the `catch_unwind` above, and turn into
        // `ERR_PANIC` with no `Event::Error` ever queued, so `drainEvents`
        // on the Lua side would surface nothing and the toggle would fail
        // silently.
        match std::thread::Builder::new()
            .name("localsend".into())
            .spawn(move || run_worker(config, worker_status, stop_rx))
        {
            Ok(_handle) => {
                *guard = Some(Running { stop_tx, status });
                OK
            }
            Err(err) => {
                events::push(&events::Event::Error {
                    message: format!("could not start thread: {err}"),
                });
                ERR_START
            }
        }
    })
    .unwrap_or(ERR_PANIC)
}

/// Body of the OS thread spawned by `ls_start`. Wraps `run_worker_inner` in
/// `catch_unwind`: this thread is detached (`ls_stop` never joins it), so
/// an uncaught panic would kill the worker silently and leave `LiveStatus`
/// stuck at `Starting` forever, with no event and no way for a caller to
/// ever recover via a retry (see the `stale_failed` check in `ls_start`,
/// which only fires on `Failed`).
fn run_worker(
    config: StartConfig,
    status: Arc<StdMutex<LiveStatus>>,
    stop_rx: oneshot::Receiver<()>,
) {
    let status_for_panic = status.clone();
    let outcome = catch_unwind(AssertUnwindSafe(move || {
        run_worker_inner(config, status, stop_rx);
    }));
    if outcome.is_err() {
        events::push(&events::Event::Error {
            message: "internal error: worker thread panicked".to_string(),
        });
        *status_for_panic
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = LiveStatus::Failed;
    }
}

/// Owns the tokio runtime for the whole lifetime of one start/stop cycle:
/// builds it, drives `service::start` to completion, publishes the result
/// into `status`, parks on `stop_rx` once running, then drives
/// `service::stop` and shuts the runtime down. None of this ever touches
/// the calling (UI) thread.
fn run_worker_inner(
    config: StartConfig,
    status: Arc<StdMutex<LiveStatus>>,
    stop_rx: oneshot::Receiver<()>,
) {
    let set_status = |s: LiveStatus| {
        *status.lock().unwrap_or_else(PoisonError::into_inner) = s;
    };

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
            set_status(LiveStatus::Failed);
            return;
        }
    };

    match rt.block_on(service::start(config)) {
        Ok(mut svc) => {
            set_status(LiveStatus::Running {
                alias: svc.alias.clone(),
                port: svc.port,
                multicast_error: svc.multicast_error.clone(),
                pending: svc.pending.clone(),
                receiving: svc.receiving.clone(),
            });
            // Pushed only after LiveStatus is Running, not from inside
            // service::start, so a consumer that sees `started` on the
            // queue can never observe running:false or get ERR_STATE from
            // ls_accept/ls_decline right after.
            events::push(&events::Event::Started {
                alias: svc.alias.clone(),
                port: svc.port,
            });
            // Park here until ls_stop signals (or the sender is dropped,
            // e.g. the process is exiting), then tear the service down and
            // shut the runtime down, all still off the UI thread.
            rt.block_on(async {
                let _ = stop_rx.await;
            });
            rt.block_on(service::stop(&mut svc));
            rt.shutdown_background();
        }
        Err(err) => {
            events::push(&events::Event::Error { message: err });
            set_status(LiveStatus::Failed);
            rt.shutdown_background();
        }
    }
}

#[no_mangle]
pub extern "C" fn ls_stop() -> c_int {
    catch_unwind(|| {
        let Some(running) = state().take() else {
            return OK;
        };
        // Signal the worker thread and detach without joining: it owns the
        // tokio runtime and cleans itself up (service::stop, then runtime
        // shutdown) asynchronously off this thread. Joining here would put
        // back the multi-second UI stall this whole restructure removes.
        // `state().take()` above already guarantees this send only ever
        // happens once, even across repeated ls_stop calls.
        let _ = running.stop_tx.send(());
        OK
    })
    .unwrap_or(ERR_PANIC)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    running: bool,
    /// True only while the worker thread spawned by `ls_start` is still
    /// doing first-run identity keygen / binding sockets and hasn't reached
    /// `running` (or failed) yet. Lets Lua distinguish "not started" from
    /// "starting" instead of showing a plain off state for the several
    /// seconds keygen can take on slow hardware.
    starting: bool,
    alias: Option<String>,
    port: Option<u16>,
    local_ips: Vec<String>,
    multicast_error: Option<String>,
}

fn not_running_status(starting: bool) -> Status {
    Status {
        running: false,
        starting,
        alias: None,
        port: None,
        local_ips: Vec::new(),
        multicast_error: None,
    }
}

#[no_mangle]
pub extern "C" fn ls_status() -> *mut c_char {
    catch_unwind(|| {
        let guard = state();
        let status = match guard.as_ref() {
            Some(running) => {
                let live = running
                    .status
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                match &*live {
                    LiveStatus::Running {
                        alias,
                        port,
                        multicast_error,
                        ..
                    } => Status {
                        running: true,
                        starting: false,
                        alias: Some(alias.clone()),
                        port: Some(*port),
                        local_ips: service::local_ips(),
                        multicast_error: multicast_error.clone(),
                    },
                    LiveStatus::Starting => not_running_status(true),
                    LiveStatus::Failed => not_running_status(false),
                }
            }
            None => not_running_status(false),
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
        let live = running
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let LiveStatus::Running {
            pending, receiving, ..
        } = &*live
        else {
            // Starting or Failed: no service to accept/decline against yet.
            return ERR_STATE;
        };
        let ok = if accept {
            service::accept(pending, receiving, id)
        } else {
            service::decline(pending, id)
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

    // Locks the `starting` field into the JSON contract: a service that was
    // never started must report `starting:false`, not just `running:false`,
    // so Lua can tell "off" apart from "keygen/bind still in progress".
    #[test]
    fn status_reports_not_starting_when_never_started() {
        let _guard = events::TEST_QUEUE_GUARD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        assert_eq!(ls_stop(), OK); // no-op; guarantees STATE is None below
        let status_ptr = ls_status();
        let status = unsafe { CStr::from_ptr(status_ptr) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { ls_string_free(status_ptr) };
        assert!(status.contains(r#""starting":false"#), "{status}");
    }

    // A failed start used to leave STATE occupied forever (idempotent
    // re-attach kept returning OK against a dead LiveStatus::Failed), so a
    // retry via Lua's context-switch/onNetworkConnected path could never
    // actually restart the service. Seeds STATE as if a previous worker
    // already failed and exited, then asserts ls_start replaces it with a
    // freshly spawned worker instead of no-opping.
    #[test]
    fn ls_start_clears_a_stale_failed_status_and_retries() {
        let _guard = events::TEST_QUEUE_GUARD
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        assert_eq!(ls_stop(), OK); // clean slate

        let stale_status = Arc::new(StdMutex::new(LiveStatus::Failed));
        let (stop_tx, _dropped_rx) = oneshot::channel::<()>();
        *state() = Some(Running {
            stop_tx,
            status: stale_status.clone(),
        });

        // A data dir whose parent path component is a plain file, not a
        // directory, so std::fs::create_dir_all fails fast and
        // deterministically without ever reaching the network bind: this
        // test must not touch real sockets, that's what tests/smoke.rs is
        // for.
        let blocker = std::env::temp_dir().join(format!("lsffi-blocker-{}", std::process::id()));
        std::fs::write(&blocker, b"x").unwrap();
        let bad_dir = blocker.join("sub");
        let cfg = serde_json::json!({
            "alias": "a",
            "deviceModel": "m",
            "deviceType": "mobile",
            "dataDir": bad_dir.to_string_lossy(),
            "downloadDir": bad_dir.to_string_lossy(),
        })
        .to_string();
        let cfg = CString::new(cfg).unwrap();

        assert_eq!(ls_start(cfg.as_ptr()), OK);

        // A fresh worker was actually spawned, not an idempotent no-op
        // against the stale Failed entry: STATE now points at a brand new
        // status cell.
        let fresh_status = {
            let guard = state();
            let running = guard.as_ref().expect("ls_start should repopulate STATE");
            assert!(
                !Arc::ptr_eq(&running.status, &stale_status),
                "ls_start should replace a stale Failed status with a fresh one"
            );
            running.status.clone()
        };

        // Wait for the fresh worker to actually finish (fast: create_dir_all
        // fails immediately, no network I/O) so no background thread is
        // still touching EVENTS/STATE after this test's guard is released.
        let mut became_failed = false;
        for _ in 0..200 {
            if matches!(
                *fresh_status.lock().unwrap_or_else(PoisonError::into_inner),
                LiveStatus::Failed
            ) {
                became_failed = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(
            became_failed,
            "fresh worker should have failed fast against the blocked data dir"
        );

        assert_eq!(ls_stop(), OK);
        let _ = std::fs::remove_file(&blocker);
    }
}
