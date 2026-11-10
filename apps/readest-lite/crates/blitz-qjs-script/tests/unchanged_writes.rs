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

#[derive(Default)]
struct Requests {
    redraws: AtomicUsize,
    restyles: AtomicUsize,
}
impl ShellProvider for Requests {
    fn request_redraw(&self) {
        self.redraws.fetch_add(1, Ordering::Relaxed);
    }
    fn request_restyle(&self) {
        self.restyles.fetch_add(1, Ordering::Relaxed);
    }
}

// React 19 clears an input's `name` and sets it back on every update of the input. Readest's
// reader re-renders its sliders' inputs after each page turn, and every one of those updates cost
// a Kindle a paint and a present (~85 ms) of a frame identical to the one before.
#[test]
fn clearing_and_restoring_an_input_name_repaints_only_if_a_selector_sees_it() {
    let html = "<!DOCTYPE html><html><head><style>input[name=q] { color: red }</style></head>\
        <body><input id='i'></body></html>";
    let requests = Arc::new(Requests::default());
    let config = DocumentConfig {
        shell_provider: Some(requests.clone()),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    let counts = || {
        (
            requests.redraws.load(Ordering::Relaxed),
            requests.restyles.load(Ordering::Relaxed),
        )
    };
    let (redraws, restyles) = counts();
    doc.eval(
        "const i = document.getElementById('i'); i.name = ''; i.removeAttribute('name');",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let (after_redraws, after_restyles) = counts();
    assert_eq!(after_redraws, redraws);
    assert!(after_restyles > restyles);
    doc.inner_mut().resolve(0.0);
    assert!(!doc.inner().damaged_by_last_resolve());

    // a name a selector matches restyles the input, and that damages it
    doc.eval("i.name = 'q';", "test");
    assert_eq!(counts(), (redraws, after_restyles + 1));
    doc.inner_mut().resolve(0.0);
    assert!(doc.inner().damaged_by_last_resolve());
}

// foliate-js's paginator marks the views it hides from assistive tech with `aria-hidden` on every
// page turn, and a section it loads gets classes, `tabindex` and `data-*` attributes. None of them
// reaches the screen but through a selector, yet each asked for a paint: on a Kindle, a frame per
// turn identical to the one before (~50-70 ms).
#[test]
fn attributes_only_selectors_read_repaint_only_if_a_selector_sees_them() {
    let html = "<!DOCTYPE html><html><head><style>.shown { color: red }\
        [aria-hidden=true] { display: none }</style></head>\
        <body><div id='d'>text</div></body></html>";
    let requests = Arc::new(Requests::default());
    let config = DocumentConfig {
        shell_provider: Some(requests.clone()),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    let redraws = || requests.redraws.load(Ordering::Relaxed);
    let before = redraws();
    doc.eval(
        "const d = document.getElementById('d'); d.setAttribute('aria-hidden', 'false'); \
         d.setAttribute('aria-label', 'x'); d.setAttribute('data-k', 'v'); d.className = 'other'; \
         d.tabIndex = -1; d.setAttribute('role', 'region'); d.title = 't'; \
         d.removeAttribute('data-k');",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(redraws(), before);
    doc.inner_mut().resolve(0.0);
    assert!(!doc.inner().damaged_by_last_resolve());

    // the same attributes, now matched by a selector, damage the element
    for change in [
        "d.setAttribute('aria-hidden', 'true');",
        "d.className = 'shown';",
    ] {
        doc.eval(change, "test");
        doc.inner_mut().resolve(0.0);
        assert!(doc.inner().damaged_by_last_resolve(), "{change}");
        doc.eval(
            "d.removeAttribute('aria-hidden'); d.className = '';",
            "test",
        );
        doc.inner_mut().resolve(0.0);
    }
}
