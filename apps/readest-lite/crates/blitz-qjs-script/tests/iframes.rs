//! Documents in iframes: foliate-js's paginator renders each section in one and works on its
//! contentDocument.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;

const PAGE: &str = r#"<!DOCTYPE html><html><head><style>body { margin: 0 }</style></head><body>
<iframe style="width: 300px; height: 200px; border: 0" srcdoc="<html><head><style>p { width: 50px; margin: 0 }</style></head><body style='margin: 0'><p id='x'>hi</p></body></html>"></iframe>
</body></html>"#;

/// Runs each script in turn on the page, laying it out in between as the host does (which is
/// when iframes fire `load`); returns the console.log lines and JS errors.
fn run(scripts: &[&str]) -> (Vec<String>, Vec<String>) {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    for script in scripts {
        doc.eval(script, "test");
        doc.run_jobs();
        doc.inner_mut().resolve(0.0);
        doc.call_global("__blitzAfterLayout", ());
    }
    let logs = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned));
    (logs.collect(), doc.take_js_errors())
}

#[test]
fn content_document_is_the_iframes_own() {
    let (logs, errors) = run(&[r#"
        const f = document.querySelector('iframe');
        const d = f.contentDocument;
        const p = d.getElementById('x');
        console.log(d !== document, d.nodeType, f.contentDocument === d, p.textContent, document.getElementById('x'));
        console.log(p.ownerDocument === d, d.body.ownerDocument === d, p.isConnected, d.documentElement.localName);
        const w = d.defaultView;
        console.log(w !== window, f.contentWindow === w, w.document === d, w.frameElement === f, w.innerWidth, w.innerHeight);
        console.log(getComputedStyle(p).width, p.getBoundingClientRect().width, w.getComputedStyle(p).width);
        const s = d.createElement('span');
        d.body.append(s, 'tail');
        console.log(s.ownerDocument === d, d.body.lastChild.data, d.querySelectorAll('span').length, document.querySelectorAll('span').length);
        try { d.body.appendChild(document.createElement('b')); } catch (e) { console.log(e.name); }
    "#]);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "true 9 true hi null",
            "true true true html",
            "true true true true 300 200",
            "50px 50 50px",
            "true tail 1 0",
            "WrongDocumentError",
        ]
    );
}

#[test]
fn events_bubble_to_the_iframes_window_and_load_fires_on_a_new_document() {
    let (logs, errors) = run(&[
        r#"
        const f = document.querySelector('iframe');
        const d = f.contentDocument;
        const seen = [];
        d.defaultView.addEventListener('ping', () => seen.push('frame window'));
        d.addEventListener('ping', () => seen.push('frame document'));
        window.addEventListener('ping', () => seen.push('page window'));
        d.getElementById('x').dispatchEvent(new Event('ping', { bubbles: true }));
        console.log(seen.join(', '));
        globalThis.first = d;
        f.addEventListener('load', () => console.log('load', f.contentDocument !== first, f.contentDocument.body.textContent));
        f.srcdoc = '<p>two</p>';
        "#,
        "console.log('after layout');",
    ]);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "frame document, frame window",
            "load true two",
            "after layout"
        ]
    );
}
