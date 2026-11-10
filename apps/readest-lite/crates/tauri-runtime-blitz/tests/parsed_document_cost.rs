//! A document a script parses (`DOMParser`, `createHTMLDocument`) is never laid out, so it is not
//! given the system's fonts. Scanning them took tens of milliseconds on a desktop and about a
//! second on a Kindle, and Readest parses one for every section it loads (`mountAdditionalFonts`),
//! so loading the next section blocked page turns. The cost is compared with a scan measured in
//! the same run, so a slow or loaded machine scales both.

use blitz_dom::{BaseDocument, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use std::time::{Duration, Instant};

fn fastest(mut f: impl FnMut()) -> Duration {
    (0..5)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed()
        })
        .min()
        .unwrap()
}

#[test]
fn parsing_a_document_does_not_scan_the_system_fonts() {
    // The default config is what the page gets without bundled fonts: a scan of the system's.
    let scan = fastest(|| drop(BaseDocument::new(DocumentConfig::default())));
    if scan < Duration::from_millis(5) {
        eprintln!("skipped: a font scan takes {scan:?} here, too little to compare with");
        return;
    }
    let mut doc = QjsDocument::from_html("<html><body></body></html>", DocumentConfig::default());
    doc.eval(include_str!("../src/dom-parser.js"), "dom-parser.js");
    let parse = fastest(|| {
        doc.eval(
            "new DOMParser().parseFromString('<link rel=\"stylesheet\" href=\"a.css\">', 'text/html');
            document.implementation.createHTMLDocument('t');",
            "parse",
        )
    });
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert!(
        parse * 4 < scan,
        "parsing two tiny documents took {parse:?}, about a system font scan ({scan:?})"
    );
}
