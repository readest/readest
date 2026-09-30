//! Chrome DevTools Protocol screenshot for the mesh page-curl (#555) on
//! the Chromium desktops: WebView2 on Windows, CEF on Linux.
//!
//! `Page.captureScreenshot` with a `clip` returns exactly the requested
//! region, so neither platform has to decode and crop a full-view capture.

use crate::models::CaptureWebviewRegionRequest;

pub const SCREENSHOT_METHOD: &str = "Page.captureScreenshot";

/// The clip is in CSS pixels of the page, which equal the viewport's
/// because the app shell never scrolls; Chromium renders it at the
/// device scale, so HiDPI screens get a full-resolution texture. JPEG,
/// as on Android: the page is opaque and PNG encoding is several times
/// slower. `captureBeyondViewport: false` keeps Chromium from resizing
/// the view to fit the clip, which would reflow the live page.
pub fn screenshot_params(payload: &CaptureWebviewRegionRequest) -> String {
    serde_json::json!({
        "format": "jpeg",
        "quality": 90,
        "captureBeyondViewport": false,
        "clip": {
            "x": payload.x,
            "y": payload.y,
            "width": payload.width,
            "height": payload.height,
            "scale": 1.0,
        },
    })
    .to_string()
}

/// Image bytes from a `Page.captureScreenshot` result (`{"data": base64}`).
pub fn decode_screenshot(result: &[u8]) -> Result<Vec<u8>, String> {
    use base64::Engine;

    let result: serde_json::Value =
        serde_json::from_slice(result).map_err(|e| format!("bad screenshot result: {e}"))?;
    let data = result
        .get("data")
        .and_then(|data| data.as_str())
        .filter(|data| !data.is_empty())
        .ok_or("screenshot result has no image data")?;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("bad screenshot data: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn params_clip_the_region_without_growing_the_viewport() {
        let params: serde_json::Value =
            serde_json::from_str(&screenshot_params(&CaptureWebviewRegionRequest {
                x: 10.5,
                y: 20.0,
                width: 300.0,
                height: 400.25,
            }))
            .unwrap();
        assert_eq!(params["format"], "jpeg");
        assert_eq!(params["captureBeyondViewport"], false);
        assert_eq!(params["clip"]["x"], 10.5);
        assert_eq!(params["clip"]["y"], 20.0);
        assert_eq!(params["clip"]["width"], 300.0);
        assert_eq!(params["clip"]["height"], 400.25);
        assert_eq!(params["clip"]["scale"], 1.0);
    }

    #[test]
    fn decodes_the_base64_image_data() {
        let bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0x00];
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let result = format!(r#"{{"data":"{encoded}"}}"#);
        assert_eq!(decode_screenshot(result.as_bytes()).unwrap(), bytes);
    }

    #[test]
    fn rejects_a_result_without_image_data() {
        assert!(decode_screenshot(b"{}").is_err());
        assert!(decode_screenshot(br#"{"data":""}"#).is_err());
        assert!(decode_screenshot(b"not json").is_err());
    }
}
