//! Writes that leave the DOM as it was: foliate-js's paginator sets `aria-hidden` on its views,
//! and some inline styles, to the value they already have, several times a page turn.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::ShellProvider;

struct Redraws(AtomicUsize);
impl ShellProvider for Redraws {
    fn request_redraw(&self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
}

// Each one restyled the element (the next layout read then laid the page out again, ~1 ms on the
// host, 4-5 times a turn) and asked for a repaint.
#[test]
fn a_write_that_changes_nothing_neither_restyles_nor_repaints() {
    let html = "<!DOCTYPE html><html><body>\
        <div id='d' aria-hidden='true' style='color: red'>x</div></body></html>";
    let redraws = Arc::new(Redraws(AtomicUsize::new(0)));
    let config = DocumentConfig {
        shell_provider: Some(redraws.clone()),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    let state = |doc: &QjsDocument| {
        (
            redraws.0.load(Ordering::Relaxed),
            doc.inner().root_node().has_dirty_descendants(),
        )
    };
    let (before, _) = state(&doc);
    doc.eval(
        "const d = document.getElementById('d');
        d.setAttribute('aria-hidden', 'true');
        d.removeAttribute('title');
        d.style.color = 'red';
        d.style.background = '';",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(state(&doc), (before, false));
    // a write that does change something still does both
    doc.eval("d.setAttribute('aria-hidden', 'false');", "test");
    let (after, dirty) = state(&doc);
    assert!(after > before && dirty);
}
