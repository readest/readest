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
        // a node of the page moves into the iframe's document (adopted)
        const b = document.createElement('b');
        d.body.appendChild(b);
        console.log(b.ownerDocument === d, d.querySelectorAll('b').length, document.querySelectorAll('b').length);
        // foliate-js's paginator focuses the section's window after each turn
        w.focus(); w.blur(); window.focus();
        console.log(typeof w.focus, typeof window.blur);
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
            "true 1 0",
            "function function",
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

#[test]
fn a_change_in_an_iframe_is_laid_out_while_the_page_is_unchanged() {
    // the page was laid out by the first query and nothing in it changes after
    let (logs, errors) = run(&[r#"
        const p = document.querySelector('iframe').contentDocument.getElementById('x');
        console.log(p.getBoundingClientRect().width);
        p.style.width = '80px';
        console.log(p.getBoundingClientRect().width, document.querySelector('iframe').getBoundingClientRect().width);
    "#]);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["50", "80 300"]);
}

/// The width #x in the iframe's document was last laid out at (0 before any layout), read
/// without laying anything out.
fn laid_out_width(doc: &QjsDocument) -> f32 {
    let page = doc.inner();
    let iframe = page.query_selector("iframe").unwrap().unwrap();
    let element = page.get_node(iframe).unwrap().element_data().unwrap();
    let sub = element.sub_doc_data().unwrap().inner();
    let x = sub.get_element_by_id("x").unwrap();
    sub.get_node(x).unwrap().final_layout().size.width
}

// The reader reads its own layout many times while a chapter loads in its (hidden) iframe. Each
// read laid out the chapter too: ~170 ms on a Kindle, once with only the book's CSS, thrown away
// when Readest's styles went in.
#[test]
fn a_read_lays_out_its_own_document_and_not_the_iframes() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    doc.inner_mut().resolve(0.0);
    assert_eq!(laid_out_width(&doc), 50.0);
    doc.eval(
        "const f = document.querySelector('iframe');
        const p = f.contentDocument.getElementById('x');
        p.style.width = '80px';
        console.log(f.getBoundingClientRect().width, f.offsetWidth);",
        "test",
    );
    assert_eq!(laid_out_width(&doc), 50.0);
    doc.eval("console.log(p.getBoundingClientRect().width);", "test");
    assert_eq!(laid_out_width(&doc), 80.0);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<_> = doc.take_messages().into_iter().collect();
    assert_eq!(logs, ["log: 300 300", "log: 80"]);
}

// A read of the page's own layout resolves the page alone, so its damage waits for the next
// paint; that paint skipped the iframes' documents while the damage it had not taken yet stood,
// and showed a change made in an iframe after the read a frame late.
#[test]
fn paint_lays_out_an_iframe_changed_after_a_read_of_the_page() {
    let mut doc = QjsDocument::from_html(PAGE, DocumentConfig::default());
    doc.inner_mut().resolve(0.0);
    doc.inner_mut().take_damage();
    doc.eval(
        "document.body.style.paddingTop = '1px';
        console.log(document.body.offsetHeight > 0);
        document.querySelector('iframe').contentDocument.getElementById('x').style.width = '80px';",
        "test",
    );
    doc.inner_mut().resolve(0.0);
    assert_eq!(laid_out_width(&doc), 80.0);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: true"]);
}

// foliate-js keeps a chapter's iframe `visibility: hidden` until it has put Readest's styles in.
// Paint draws nothing of a hidden iframe, so laying its document out for paint was work thrown
// away; a read in it, or showing it, lays it out.
#[test]
fn paint_lays_out_the_documents_of_shown_iframes_only() {
    let hidden = PAGE.replace("border: 0\"", "border: 0; visibility: hidden\"");
    let mut doc = QjsDocument::from_html(&hidden, DocumentConfig::default());
    doc.inner_mut().resolve(0.0);
    assert_eq!(laid_out_width(&doc), 0.0);
    doc.eval(
        "const f = document.querySelector('iframe');
        const p = f.contentDocument.getElementById('x');
        console.log(p.getBoundingClientRect().width);
        p.style.width = '80px';",
        "test",
    );
    doc.inner_mut().resolve(0.0);
    assert_eq!(laid_out_width(&doc), 50.0);
    doc.eval("f.style.visibility = 'visible';", "test");
    doc.inner_mut().resolve(0.0);
    assert_eq!(laid_out_width(&doc), 80.0);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: 50"]);
}

#[test]
fn a_hidden_iframe_still_fires_load() {
    let hidden = PAGE.replace("border: 0\"", "border: 0; visibility: hidden\"");
    let mut doc = QjsDocument::from_html(&hidden, DocumentConfig::default());
    doc.eval(
        "const f = document.querySelector('iframe');
        f.addEventListener('load', () => console.log('load', f.contentDocument.body.textContent));
        f.srcdoc = '<p>two</p>';",
        "test",
    );
    doc.run_jobs();
    doc.inner_mut().resolve(0.0);
    doc.call_global("__blitzAfterLayout", ());
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: load two"]);
}

/// readest-app walks a section's `document.styleSheets` to resolve its `@media (orientation)`
/// rules against the reading area (main's #7450). Lite has no CSSOM (Blitz parses the sheets
/// natively), so the list is empty and the sheets stay as written; without one the walk threw in
/// the section's load handler, before the reader wired up taps on the book.
#[test]
fn style_sheets_is_an_empty_list() {
    let (logs, errors) = run(&[r#"
        for (const d of [document, document.querySelector('iframe').contentDocument]) {
          const sheets = d.styleSheets;
          console.log([Array.from(sheets).length, sheets.length, String(sheets.item(0))].join(' '));
        }
    "#]);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["0 0 null", "0 0 null"]);
}

/// A node kept from a section that was unloaded (its iframe removed) has no document left in
/// Lite: `ownerDocument` is null rather than a throw. Readest's position tracker keeps the
/// previous position's range and reads its `startContainer.ownerDocument`; a search result in
/// another section threw there and crashed the reader to its error page.
#[test]
fn a_node_of_a_removed_iframe_has_no_document() {
    let (logs, errors) = run(&[
        "globalThis.kept = document.querySelector('iframe').contentDocument.getElementById('x');
         console.log(kept.ownerDocument === document.querySelector('iframe').contentDocument);
         document.querySelector('iframe').remove();",
        "console.log(String(kept.ownerDocument));",
    ]);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["true", "null"]);
}
