use serde_json::json;
use tauri_plugin_native_bridge::{WebBrowserRequest, WebBrowserResponse, WebBrowserStatusRequest};

#[test]
fn web_browser_request_round_trips_camel_case_fields() {
    let request: WebBrowserRequest = serde_json::from_value(json!({
        "url": "https://calibre.example.com",
        "downloadDir": "/tmp/browser-downloads",
        "isEink": true,
        "labels": { "close": "Schließen" }
    }))
    .unwrap();
    assert_eq!(request.url, "https://calibre.example.com");
    assert_eq!(request.download_dir, "/tmp/browser-downloads");
    assert_eq!(request.is_eink, Some(true));
    assert_eq!(
        request.labels.get("close").map(String::as_str),
        Some("Schließen")
    );
    assert!(request.background.is_none());

    let json = serde_json::to_value(&request).unwrap();
    assert_eq!(json["downloadDir"], "/tmp/browser-downloads");
    assert_eq!(json["isEink"], true);
}

#[test]
fn web_browser_response_and_status_use_camel_case() {
    let response: WebBrowserResponse =
        serde_json::from_value(json!({ "openBookHash": "abc" })).unwrap();
    assert_eq!(response.open_book_hash.as_deref(), Some("abc"));
    let empty: WebBrowserResponse = serde_json::from_value(json!({})).unwrap();
    assert!(empty.open_book_hash.is_none());

    let status = WebBrowserStatusRequest {
        state: "added".into(),
        filename: "dune.epub".into(),
        book_hash: Some("h".into()),
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["bookHash"], "h");
    assert_eq!(json["filename"], "dune.epub");
}
