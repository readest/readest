use serde_json::json;
use tauri_plugin_native_bridge::{
    WebBrowserImage, WebBrowserRequest, WebBrowserResponse, WebBrowserStatusRequest,
};

#[test]
fn browser_image_selection_contract_survives_native_round_trip() {
    let mut json = serde_json::to_value(WebBrowserRequest::default()).unwrap();
    json["selectImage"] = json!(true);
    json["imageSelectionScript"] = json!("fixed selection script");
    let request: WebBrowserRequest = serde_json::from_value(json).unwrap();
    let json = serde_json::to_value(request).unwrap();
    assert_eq!(json["selectImage"], true, "image mode must reach mobile");
    assert_eq!(json["imageSelectionScript"], "fixed selection script");
    let response: WebBrowserResponse = serde_json::from_value(json!({
        "image": {"url": "https://cdn.example/cover.jpg", "pageUrl": "https://example/search"}
    }))
    .unwrap();
    let json = serde_json::to_value(response).unwrap();
    assert_eq!(
        json["image"]["url"], "https://cdn.example/cover.jpg",
        "selected image must return to the caller"
    );
    assert_eq!(json["image"]["pageUrl"], "https://example/search");
}

#[test]
fn image_selection_accepts_only_absolute_http_urls_for_both_fields() {
    let valid = WebBrowserImage {
        url: "https://cdn.example/cover.jpg?size=large&format=jpg".into(),
        page_url: "http://search.example/images".into(),
    };
    assert!(valid.is_valid());
    for invalid in [
        "javascript:alert(1)",
        "file:///cover.jpg",
        "data:image/png;base64,AA",
        "blob:https://example/id",
        "/relative.jpg",
        "example.com/cover.jpg",
        "",
        "https://",
    ] {
        let mut image = valid.clone();
        image.url = invalid.into();
        assert!(!image.is_valid(), "reject image URL: {invalid}");
        let mut image = valid.clone();
        image.page_url = invalid.into();
        assert!(!image.is_valid(), "reject source page URL: {invalid}");
    }
}

#[test]
fn web_browser_request_round_trips_camel_case_fields() {
    let request: WebBrowserRequest = serde_json::from_value(json!({
        "url": "https://calibre.example.com",
        "downloadDir": "/tmp/browser-downloads",
        "captureScript": "fixed capture script",
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
