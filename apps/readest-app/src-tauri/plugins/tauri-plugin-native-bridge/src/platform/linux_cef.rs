//! CEF view snapshot for the mesh page-curl (#555), through the browser's
//! DevTools protocol (see `cdp.rs`). The observer pattern follows
//! `tauri-runtime-cef`'s own `Runtime.evaluate` callback.

use std::any::Any;
use std::os::raw::c_int;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Runtime;
use tauri_runtime_cef::cef::*;

use super::cdp;

/// Chromium produces a fresh frame for the screenshot, so the first one can
/// take longer than WebKit's snapshot on macOS. A timeout makes the JS side
/// give up on captured turns for the session, so leave room.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_millis(1000);

/// DevTools message ids, kept far above the small ids the runtime hands its
/// own messages so an observer never claims another caller's result.
static NEXT_MESSAGE_ID: AtomicI32 = AtomicI32::new(0x4000_0000);

type SnapshotSender = mpsc::Sender<Result<Vec<u8>, String>>;
/// The observer's registration. It keeps the observer alive and the
/// observer holds it, so every way out of a capture must take it: the
/// result, the DevTools agent detaching, or the caller timing out.
type SharedRegistration = Arc<Mutex<Option<Registration>>>;

pub fn capture_webview_region<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> crate::Result<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let registration = SharedRegistration::default();
    let observer_registration = registration.clone();
    window
        .with_webview(move |webview| {
            // Runs on the CEF UI thread, which also delivers the result.
            let webview: &dyn Any = &*webview;
            let Some(host) = webview
                .downcast_ref::<tauri_runtime_cef::Webview>()
                .and_then(|webview| webview.browser().host())
            else {
                let _ = tx.send(Err("not a CEF webview".into()));
                return;
            };
            request_screenshot(&host, tx, observer_registration);
        })
        .map_err(|e| crate::Error::NativeBridgeError(e.to_string()))?;
    match rx.recv_timeout(SNAPSHOT_TIMEOUT) {
        Ok(Ok(image)) => Ok(image),
        Ok(Err(err)) => Err(crate::Error::NativeBridgeError(err)),
        Err(_) => {
            // Unregister on the UI thread, where the observer lives.
            let _ = window.with_webview(move |_| drop(registration.lock().unwrap().take()));
            Err(crate::Error::NativeBridgeError(
                "webview snapshot timed out".into(),
            ))
        }
    }
}

fn request_screenshot(host: &BrowserHost, tx: SnapshotSender, registration: SharedRegistration) {
    let message_id = NEXT_MESSAGE_ID.fetch_add(1, Ordering::Relaxed);
    let tx = Arc::new(Mutex::new(Some(tx)));
    let mut observer =
        ScreenshotDevToolsObserver::new(message_id, tx.clone(), registration.clone());
    let Some(observer_registration) = host.add_dev_tools_message_observer(Some(&mut observer))
    else {
        send(&tx, Err("cannot observe DevTools messages".into()));
        return;
    };
    *registration.lock().unwrap() = Some(observer_registration);

    let message = format!(
        r#"{{"id":{message_id},"method":"{}","params":{}}}"#,
        cdp::SCREENSHOT_METHOD,
        cdp::screenshot_params(),
    );
    if host.send_dev_tools_message(Some(message.as_bytes())) != 1 {
        let _ = registration.lock().unwrap().take();
        send(&tx, Err("DevTools message not sent".into()));
    }
}

fn send(tx: &Mutex<Option<SnapshotSender>>, result: Result<Vec<u8>, String>) {
    if let Some(tx) = tx.lock().unwrap().take() {
        let _ = tx.send(result);
    }
}

wrap_dev_tools_message_observer! {
    struct ScreenshotDevToolsObserver {
        message_id: c_int,
        tx: Arc<Mutex<Option<SnapshotSender>>>,
        registration: SharedRegistration,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(
            &self,
            _browser: Option<&mut Browser>,
            message_id: c_int,
            success: c_int,
            result: Option<&[u8]>,
        ) {
            if message_id != self.message_id {
                return;
            }
            let result = result.unwrap_or_default();
            send(
                &self.tx,
                if success != 0 {
                    cdp::decode_screenshot(result)
                } else {
                    Err(String::from_utf8_lossy(result).into_owned())
                },
            );
            // Unregisters this observer.
            let _ = self.registration.lock().unwrap().take();
        }

        // CEF drops pending results when the agent detaches.
        fn on_dev_tools_agent_detached(&self, _browser: Option<&mut Browser>) {
            send(&self.tx, Err("DevTools agent detached".into()));
            let _ = self.registration.lock().unwrap().take();
        }
    }
}
