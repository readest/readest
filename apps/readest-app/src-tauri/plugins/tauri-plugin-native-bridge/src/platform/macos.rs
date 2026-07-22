//! WKWebView region snapshot for the mesh page-curl (#555).
//!
//! `WKWebView takeSnapshotWithConfiguration:completionHandler:` renders
//! the current page (annotations and all) into an NSImage without
//! flushing or disturbing the live view. The rect is in the web view's
//! own coordinate space, which for a standard Tauri window matches the
//! JS viewport's CSS pixels; the snapshot itself comes back at the
//! screen's backing scale, so callers get a Retina-resolution PNG.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use block::ConcreteBlock;
use cocoa::base::{id, nil};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{class, msg_send, sel, sel_impl};
use tauri::Runtime;

use crate::models::CaptureWebviewRegionRequest;

/// `NSBitmapImageFileTypePNG`
const NS_BITMAP_IMAGE_FILE_TYPE_PNG: u64 = 4;

/// How long to wait for WebKit before giving up. Snapshots normally
/// complete within a frame or two; a timeout means the JS side should
/// fall back to the CSS curl rather than stall the page turn.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_millis(500);

pub fn capture_webview_region<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    payload: CaptureWebviewRegionRequest,
) -> crate::Result<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |webview| unsafe {
            // Runs on the main thread; `inner()` is the WKWebView.
            take_snapshot_png(webview.inner() as id, payload, tx);
        })
        .map_err(|e| crate::Error::NativeBridgeError(e.to_string()))?;
    match rx.recv_timeout(SNAPSHOT_TIMEOUT) {
        Ok(Ok(png)) => Ok(png),
        Ok(Err(err)) => Err(crate::Error::NativeBridgeError(err)),
        Err(_) => Err(crate::Error::NativeBridgeError(
            "webview snapshot timed out".into(),
        )),
    }
}

/// SAFETY: must run on the main thread; `webview` must be a live WKWebView.
unsafe fn take_snapshot_png(
    webview: id,
    payload: CaptureWebviewRegionRequest,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
) {
    if webview.is_null() {
        let _ = tx.send(Err("webview handle is null".into()));
        return;
    }
    let config: id = msg_send![class!(WKSnapshotConfiguration), new];
    let rect = NSRect::new(
        NSPoint::new(payload.x, payload.y),
        NSSize::new(payload.width, payload.height),
    );
    let _: () = msg_send![config, setRect: rect];

    // `ConcreteBlock` requires `Fn`, but the sender must move out on the
    // (single) completion call — park it in a Mutex<Option<_>>.
    let tx_cell = Mutex::new(Some(tx));
    let block = ConcreteBlock::new(move |image: id, error: id| {
        let Some(tx) = tx_cell.lock().ok().and_then(|mut guard| guard.take()) else {
            return;
        };
        let _ = tx.send(unsafe { png_from_snapshot(image, error) });
    });
    // WebKit copies the handler it stores, so our reference can drop
    // when this closure returns.
    let block = block.copy();
    let _: () =
        msg_send![webview, takeSnapshotWithConfiguration: config completionHandler: &*block];
    let _: () = msg_send![config, release];
}

/// SAFETY: main thread, called from the snapshot completion handler.
unsafe fn png_from_snapshot(image: id, error: id) -> Result<Vec<u8>, String> {
    if image == nil {
        return Err(describe_nserror(error));
    }
    // NSImage → NSBitmapImageRep → PNG. TIFFRepresentation is an extra
    // copy but avoids dropping to CoreGraphics for a once-per-turn call.
    let tiff: id = msg_send![image, TIFFRepresentation];
    if tiff == nil {
        return Err("snapshot has no TIFF representation".into());
    }
    let rep: id = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
    if rep == nil {
        return Err("snapshot TIFF not decodable".into());
    }
    let props: id = msg_send![class!(NSDictionary), dictionary];
    let png: id =
        msg_send![rep, representationUsingType: NS_BITMAP_IMAGE_FILE_TYPE_PNG properties: props];
    if png == nil {
        return Err("PNG encoding failed".into());
    }
    let len: usize = msg_send![png, length];
    let bytes: *const u8 = msg_send![png, bytes];
    if bytes.is_null() || len == 0 {
        return Err("PNG encoding produced no data".into());
    }
    Ok(std::slice::from_raw_parts(bytes, len).to_vec())
}

/// SAFETY: `error` is an NSError or nil.
unsafe fn describe_nserror(error: id) -> String {
    if error == nil {
        return "snapshot returned no image".into();
    }
    let desc: id = msg_send![error, localizedDescription];
    if desc == nil {
        return "snapshot failed".into();
    }
    let utf8: *const std::os::raw::c_char = msg_send![desc, UTF8String];
    if utf8.is_null() {
        return "snapshot failed".into();
    }
    std::ffi::CStr::from_ptr(utf8)
        .to_string_lossy()
        .into_owned()
}
