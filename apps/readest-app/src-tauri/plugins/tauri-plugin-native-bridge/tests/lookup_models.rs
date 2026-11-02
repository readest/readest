use serde_json::json;
use tauri_plugin_native_bridge::ShowLookupPopoverRequest;

#[test]
fn fullscreen_lookup_preference_survives_the_mobile_bridge() {
    for full_screen in [true, false] {
        let request: ShowLookupPopoverRequest = serde_json::from_value(json!({
            "word": "whispered",
            "fullScreen": full_screen
        }))
        .unwrap();
        let forwarded = serde_json::to_value(request).unwrap();
        assert_eq!(forwarded["fullScreen"], full_screen);
        assert_eq!(forwarded["word"], "whispered");
    }
}

#[test]
fn legacy_lookup_requests_keep_the_compact_presentation() {
    let request: ShowLookupPopoverRequest =
        serde_json::from_value(json!({ "word": "whispered" })).unwrap();
    let forwarded = serde_json::to_value(request).unwrap();
    assert_eq!(forwarded, json!({ "word": "whispered" }));
}
