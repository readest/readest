use tauri_plugin_native_bridge::UpdateReadingWidgetRequest;

#[test]
fn deserializes_camel_case_payload() {
    let json = r#"{
      "books": [{"hash":"h1","title":"T","author":"A","percent":72,"coverPath":"/x/h1/cover.png"}],
      "sectionTitle": "Continue reading",
      "emptyTitle": "Your books will appear here"
    }"#;
    let req: UpdateReadingWidgetRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.books.len(), 1);
    assert_eq!(req.books[0].percent, 72);
    assert_eq!(req.books[0].cover_path, "/x/h1/cover.png");
    assert_eq!(req.section_title, "Continue reading");
    assert!(req.tts.is_none());
}

#[test]
fn deserializes_tts_field_when_present() {
    let json = r#"{
      "books": [],
      "sectionTitle": "S",
      "emptyTitle": "E",
      "tts": {"active": true, "playing": false}
    }"#;
    let req: UpdateReadingWidgetRequest = serde_json::from_str(json).unwrap();
    let tts = req.tts.expect("tts should be Some");
    assert_eq!(tts.active, true);
    assert_eq!(tts.playing, false);
}

#[test]
fn tts_is_none_when_absent() {
    let json = r#"{
      "books": [],
      "sectionTitle": "S",
      "emptyTitle": "E"
    }"#;
    let req: UpdateReadingWidgetRequest = serde_json::from_str(json).unwrap();
    assert!(req.tts.is_none());
}
