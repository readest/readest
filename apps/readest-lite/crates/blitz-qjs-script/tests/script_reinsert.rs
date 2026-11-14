//! A `<script src>` inserted again after one for the same URL loaded and ran is not loaded or run
//! again: Turbopack loads a route's chunks, then React adds the same chunks as `<script async>`.
//! It still fires `load`. A script that failed to load is tried again.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;
use std::sync::{Arc, Mutex};

/// Inserts `/chunk.js` twice, the second time 10 ms later as React does (async, a full URL), and
/// returns the console lines, the paths the loader was asked for and the JS errors.
fn insert_twice(chunk: Option<&'static str>) -> (Vec<String>, Vec<String>, Vec<String>) {
    let config = DocumentConfig {
        base_url: Some("app://host/".into()),
        ..Default::default()
    };
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        config,
    );
    let asked = Arc::new(Mutex::new(Vec::new()));
    let a = asked.clone();
    doc.set_script_loader(Box::new(move |u| {
        a.lock().unwrap().push(u.path().to_owned());
        chunk
            .filter(|_| u.path() == "/chunk.js")
            .map(|s| s.as_bytes().to_vec())
    }));
    doc.eval(
        "const add = (src, async) => {
            const s = document.createElement('script');
            if (async) s.setAttribute('async', '');
            s.setAttribute('src', src);
            s.addEventListener('load', () => console.log('load', async, globalThis.runs));
            s.addEventListener('error', () => console.log('error', async));
            document.head.appendChild(s);
        };
        add('/chunk.js', false);
        setTimeout(() => add('app://host/chunk.js', true), 10);",
        "test",
    );
    for _ in 0..3 {
        doc.run_jobs();
        doc.call_global("__blitzTimers", (1.0e12,));
    }
    let asked = asked.lock().unwrap().clone();
    (doc.take_messages(), asked, doc.take_js_errors())
}

#[test]
fn reinserted_script_runs_once() {
    let (logs, asked, errors) = insert_twice(Some("globalThis.runs = (globalThis.runs || 0) + 1;"));
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["log: load false 1", "log: load true 1"]);
    // The first insertion asks for the shipped bytecode, then the source; the second asks nothing.
    assert_eq!(asked, ["/chunk.js.qjsc", "/chunk.js"]);
}

#[test]
fn failed_script_is_tried_again() {
    let (logs, asked, errors) = insert_twice(None);
    assert_eq!(errors, ["app://host/chunk.js: cannot load"; 2]);
    assert_eq!(logs, ["log: error false", "log: error true"]);
    assert_eq!(
        asked,
        ["/chunk.js.qjsc", "/chunk.js", "/chunk.js.qjsc", "/chunk.js"]
    );
}
