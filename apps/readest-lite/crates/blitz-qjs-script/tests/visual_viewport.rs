//! `window.visualViewport`, never zoomed. foliate-js's paginator reads `visualViewport.scale` on
//! every touch move (a pinch-zoomed page doesn't turn on a swipe); without it each swipe in the
//! reader threw before turning the page. Expected values are Chromium's.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn the_visual_viewport_is_the_unzoomed_window() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 500, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html("<!DOCTYPE html><html><body></body></html>", config);
    doc.eval(
        "const v = visualViewport;
        console.log([v.scale, v.width, v.height, v.offsetLeft, v.offsetTop, v.pageLeft, v.pageTop,
            typeof v.addEventListener, v instanceof EventTarget].join(' '));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(logs, ["1 400 500 0 0 0 0 function true"]);
}
