use tauri_plugin_native_bridge::{
    BookshelfWidgetCatalog, BookshelfWidgetItem, UpdateBookshelfWidgetRequest,
};

#[test]
fn deserializes_book_and_group_items_in_order() {
    let json = r#"{
      "appWidgetId": 42,
      "shelfId": "recent",
      "items": [
        {"type":"group","id":"g1","groupBy":"series","value":"Foundation","coverPaths":["/x/a/cover.png","/x/b/cover.png"]},
        {"type":"book","hash":"h1","title":"T","author":"A","percent":72,"showProgress":true,"coverPath":"/x/h1/cover.png"}
      ],
      "sectionTitle": "Continue reading",
      "emptyTitle": "Your books will appear here"
    }"#;
    let req: UpdateBookshelfWidgetRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.app_widget_id, 42);
    assert_eq!(req.shelf_id, "recent");
    assert_eq!(req.section_title, "Continue reading");
    assert!(
        req.tts.is_none(),
        "tts should be absent when the key is missing"
    );
    assert_eq!(req.items.len(), 2);
    match &req.items[0] {
        BookshelfWidgetItem::Group(group) => {
            assert_eq!(group.value, "Foundation");
            assert_eq!(group.cover_paths.len(), 2);
        }
        other => panic!("expected a group, got {other:?}"),
    }
    match &req.items[1] {
        BookshelfWidgetItem::Book(book) => {
            assert_eq!(book.percent, 72);
            assert_eq!(book.cover_path, "/x/h1/cover.png");
        }
        other => panic!("expected a book, got {other:?}"),
    }

    // Same request shape, plus the optional tts field.
    let json_with_tts = r#"{
      "appWidgetId": 42,
      "shelfId": "recent",
      "items": [],
      "sectionTitle": "S",
      "emptyTitle": "E",
      "tts": {"active": true, "playing": false}
    }"#;
    let req_with_tts: UpdateBookshelfWidgetRequest = serde_json::from_str(json_with_tts).unwrap();
    let tts = req_with_tts
        .tts
        .expect("tts should be Some when the key is present");
    assert!(tts.active);
    assert!(!tts.playing);
}

#[test]
fn rejects_an_item_of_an_unknown_type() {
    let json = r#"{
      "appWidgetId": 42, "shelfId": "recent", "items": [{"type":"shelf"}],
      "sectionTitle": "S", "emptyTitle": "E"
    }"#;
    assert!(serde_json::from_str::<UpdateBookshelfWidgetRequest>(json).is_err());
}

#[test]
fn deserializes_the_configure_screen_catalog() {
    let json = r#"{
      "shelves": [{"id":"recent","name":"Recently read"}],
      "labels": {"title":"Bookshelf","rows":"Rows","columns":"Columns","showTitles":"Book title",
                 "showShelfName":"Shelf name","cancel":"Cancel","save":"Save","edit":"Edit",
                 "openApp":"Open Readest"}
    }"#;
    let catalog: BookshelfWidgetCatalog = serde_json::from_str(json).unwrap();
    assert_eq!(catalog.shelves[0].name, "Recently read");
    assert_eq!(catalog.labels.show_titles, "Book title");
    assert_eq!(catalog.labels.show_shelf_name, "Shelf name");
}
