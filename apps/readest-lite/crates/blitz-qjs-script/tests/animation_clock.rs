//! The clock CSS animations run on stands still while script runs, as a browser's document
//! timeline does until its next frame: a task's layout and style reads all see the page at one
//! time. Readest Lite's e-ink spinner turns while a book opens, and the clock moving under each
//! read had the page restyled for every one of them (~0.9 s more to open a book on a Kindle).

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn reads_in_one_task_see_an_animation_at_one_time() {
    let html = "<!DOCTYPE html><html><body>
        <style>@keyframes grow { from { width: 10px } to { width: 1010px } }
        #a { height: 10px; animation: grow 10s linear infinite }</style>
        <div id='a'></div></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(1200, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    blitz_qjs_script::advance_animation_time();
    doc.inner_mut().resolve(blitz_qjs_script::animation_time());
    doc.eval(
        "const a = document.getElementById('a');
        const before = a.offsetWidth;
        const until = Date.now() + 300;
        while (Date.now() < until);
        console.log(before === a.offsetWidth, getComputedStyle(a).width === before + 'px');",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(logs, ["true true"]);
}
