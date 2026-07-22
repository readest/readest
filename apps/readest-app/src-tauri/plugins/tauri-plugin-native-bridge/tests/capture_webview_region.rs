use tauri_plugin_native_bridge::{CaptureWebviewRegionRequest, CaptureWebviewRegionResponse};

#[test]
fn deserializes_camel_case_payload() {
    let json = r#"{"x": 0, "y": 44.5, "width": 402, "height": 700.25}"#;
    let req: CaptureWebviewRegionRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.x, 0.0);
    assert_eq!(req.y, 44.5);
    assert_eq!(req.width, 402.0);
    assert_eq!(req.height, 700.25);
}

#[test]
fn deserializes_mobile_base64_response() {
    let json = r#"{"data": "iVBORw0KGgo="}"#;
    let res: CaptureWebviewRegionResponse = serde_json::from_str(json).unwrap();
    assert_eq!(res.data, "iVBORw0KGgo=");
}
