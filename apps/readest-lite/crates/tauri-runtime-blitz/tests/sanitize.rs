//! DOMPurify as Readest's sanitizer transformer runs it on every section: the book's markup parsed
//! as `text/html` into a document of the page's DOM, cleaned, returned as a DOM and serialized
//! as XHTML with `XMLSerializer`. Uses DOMPurify's own build from readest-app's node_modules.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

fn run(script: &str) -> Vec<String> {
    let purify = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../readest-app/node_modules/dompurify/dist/purify.js"
    );
    let purify = std::fs::read_to_string(purify)
        .unwrap_or_else(|e| panic!("{purify}: {e} (install readest-app's dependencies)"));
    let mut doc = QjsDocument::from_html("<html><body></body></html>", DocumentConfig::default());
    doc.eval(include_str!("../src/dom-parser.js"), "dom-parser.js");
    doc.eval(&purify, "purify.js");
    doc.eval(script, "test");
    doc.run_jobs();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

const CHAPTER: &str = r##"const chapter = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>One</title><style>p > b { color: red }</style><script>alert(1)</script></head><body><h1 epub:type="title">One &amp; two</h1><p onclick="alert(2)">a<br/>b <a href="javascript:alert(3)">x</a> <a href="#n1">n</a></p><iframe srcdoc="&lt;script&gt;"></iframe><img src="blob:tauri://localhost/1"/><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg></body></html>`;"##;

#[test]
fn a_chapter_is_cleaned_and_serialized_as_xhtml() {
    let logs = run(&format!(
        "{CHAPTER}
        console.log(DOMPurify.isSupported);
        const clean = DOMPurify.sanitize(chapter, {{
          WHOLE_DOCUMENT: true,
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['srcdoc'],
          // readest-app's BOOK_URI_REGEXP: DOMPurify's default list plus blob: and data:
          ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))/i,
          ADD_TAGS: ['link', 'meta'],
          ADD_ATTR: (a) => a.startsWith('xmlns') || a.startsWith('xml:') || a.startsWith('epub:'),
          RETURN_DOM: true,
        }});
        console.log(clean.localName, clean.ownerDocument !== document, document.querySelectorAll('h1').length);
        const xhtml = new XMLSerializer().serializeToString(clean);
        console.log(/<script|onclick|javascript:|<iframe|srcdoc/.test(xhtml));
        // well-formed XHTML that keeps the book's content
        const back = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
        const $ = (s) => back.querySelector(s);
        console.log(back.documentElement.namespaceURI, $('parsererror'), $('h1').textContent, $('h1').getAttribute('epub:type'));
        console.log($('style').textContent, $('p').childNodes.length, $('a[href=\"#n1\"]') !== null, $('img').getAttribute('src'));
        console.log($('svg').namespaceURI, $('rect') !== null, back.documentElement.getAttribute('xml:lang'));"
    ));
    assert_eq!(
        logs,
        [
            "true",
            "html true 0",
            "false",
            "http://www.w3.org/1999/xhtml null One & two title",
            "p > b { color: red } 6 true blob:tauri://localhost/1",
            "http://www.w3.org/2000/svg true en",
        ]
    );
}

#[test]
fn a_fragment_is_cleaned_to_a_string() {
    // sanitizeBookFragment: markup copied out of a book into the app window
    let logs = run(
        "const s = DOMPurify.sanitize('<p>ok<img src=x onerror=alert(1)><style>*{}</style></p>', { FORBID_TAGS: ['style'] });
        console.log(s);",
    );
    assert_eq!(logs, ["<p>ok<img src=\"x\"></p>"]);
}
