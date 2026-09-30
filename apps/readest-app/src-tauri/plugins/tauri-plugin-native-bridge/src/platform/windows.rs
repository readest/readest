//! WebView2 view snapshot for the mesh page-curl (#555), through the
//! DevTools protocol (see `cdp.rs`). `ICoreWebView2::CapturePreview` would
//! also capture the whole view, but only as slow-to-encode PNG.

use std::sync::mpsc;
use std::time::Duration;

use tauri::Runtime;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows_core::HSTRING;

use super::cdp;

/// Chromium produces a fresh frame for the screenshot, so the first one can
/// take longer than WebKit's snapshot on macOS. A timeout makes the JS side
/// give up on captured turns for the session, so leave room.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_millis(1000);

pub fn capture_webview_region<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> crate::Result<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |webview| {
            // Runs on the UI thread, where WebView2 must be called and where
            // its completion handler is later delivered.
            let error_tx = tx.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result, json| {
                    let _ = tx.send(
                        result
                            .map_err(|e| e.to_string())
                            .and_then(|()| cdp::decode_screenshot(json.as_bytes())),
                    );
                    Ok(())
                },
            ));
            let called = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from(cdp::SCREENSHOT_METHOD),
                        &HSTRING::from(cdp::screenshot_params()),
                        &handler,
                    )
                })
            };
            if let Err(e) = called {
                let _ = error_tx.send(Err(e.to_string()));
            }
        })
        .map_err(|e| crate::Error::NativeBridgeError(e.to_string()))?;
    match rx.recv_timeout(SNAPSHOT_TIMEOUT) {
        Ok(Ok(image)) => Ok(image),
        Ok(Err(err)) => Err(crate::Error::NativeBridgeError(err)),
        Err(_) => Err(crate::Error::NativeBridgeError(
            "webview snapshot timed out".into(),
        )),
    }
}
