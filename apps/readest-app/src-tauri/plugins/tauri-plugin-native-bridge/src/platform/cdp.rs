//! Chrome DevTools Protocol screenshot for the mesh page-curl (#555) on
//! the Chromium desktops: WebView2 on Windows, CEF on Linux.

pub const SCREENSHOT_METHOD: &str = "Page.captureScreenshot";

/// The whole view, which the JS side crops to the requested region while
/// decoding. A `clip` would do the crop here, but Chromium implements it by
/// scrolling the viewport to the clip origin and shrinking the view to the
/// clip size for the capture, which flashes on screen: with the sidebar
/// open, the page jumped left over a black strip on every turn. Chromium
/// renders at the device scale, so HiDPI screens get a full-resolution
/// texture. JPEG, as on Android: the page is opaque and PNG encoding is
/// several times slower.
pub fn screenshot_params() -> String {
    serde_json::json!({
        "format": "jpeg",
        "quality": 90,
        "captureBeyondViewport": false,
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
    fn params_capture_the_whole_view_without_a_clip() {
        let params: serde_json::Value = serde_json::from_str(&screenshot_params()).unwrap();
        assert_eq!(params["format"], "jpeg");
        assert_eq!(params["captureBeyondViewport"], false);
        assert!(params.get("clip").is_none());
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
