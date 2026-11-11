//! Documents of their own (`text/html` parsing, `implementation.createHTMLDocument`), the
//! NodeIterator and markup serialization: what DOMPurify needs of the page's DOM.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

fn page() -> QjsDocument {
    QjsDocument::from_html(
        "<html><body><p id='x'>page</p></body></html>",
        DocumentConfig::default(),
    )
}

fn logs(doc: &mut QjsDocument, script: &str) -> Vec<String> {
    doc.eval(script, "test");
    doc.run_jobs();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn a_parsed_document_is_its_own_and_freed_when_unreachable() {
    let mut doc = page();
    let out = logs(
        &mut doc,
        "{
            // parsed as HTML whatever it looks like, so the XHTML namespace declaration is inert
            const d = __blitzParseHTML('<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>one<br/>two</p></body></html>');
            const p = d.querySelector('p');
            console.log(d !== document, d.nodeType, p.ownerDocument === d, d.defaultView, d.body.childNodes.length, document.querySelectorAll('p').length);
            const e = document.implementation.createHTMLDocument('t');
            console.log(e.title, e.body.childNodes.length, e.createElement('i').ownerDocument === e);
            globalThis.h = p._id;
            globalThis.tag = __n.ownedTag(h);
            console.log(tag > 0);
        }",
    );
    assert_eq!(out, ["true 9 true null 1 1", "t 0 true", "true"]);
    doc.run_gc();
    // the finalization callback is a job
    doc.run_jobs();
    let out = logs(&mut doc, "console.log(__n.ownedTag(h), __n.parent(h));");
    // freed: its handles reach nothing
    assert_eq!(out, ["0 undefined"]);
}

#[test]
fn a_lone_text_node_is_adopted() {
    // DOMPurify puts leading white space back with the page's createTextNode
    let mut doc = page();
    let out = logs(
        &mut doc,
        "const d = __blitzParseHTML('<p>x</p>');
        const t = document.createTextNode('  ');
        d.body.insertBefore(t, d.body.firstChild);
        console.log(t.ownerDocument === d, t.parentNode === d.body, JSON.stringify(d.body.innerHTML));
        try { d.body.append(document.getElementById('x')); } catch (e) { console.log(e.name); }",
    );
    assert_eq!(out, ["true true \"  <p>x</p>\"", "WrongDocumentError"]);
}

#[test]
fn markup_is_serialized_as_html_and_as_xml() {
    let mut doc = page();
    let out = logs(
        &mut doc,
        r#"const d = __blitzParseHTML('<body><span></span><br><p title="a&quot;b">1 &amp; 2 &lt; 3&nbsp;</p><style>a>b{}</style><svg><rect/></svg></body>');
        console.log(d.body.innerHTML);
        console.log(d.querySelector('svg').outerHTML);
        console.log(__blitzSerializeXML(d.body));"#,
    );
    assert_eq!(
        out,
        [
            "<span></span><br><p title=\"a&quot;b\">1 &amp; 2 &lt; 3&nbsp;</p><style>a>b{}</style><svg><rect></rect></svg>",
            "<svg><rect></rect></svg>",
            "<body xmlns=\"http://www.w3.org/1999/xhtml\"><span></span><br /><p title=\"a&quot;b\">1 &amp; 2 &lt; 3\u{a0}</p><style>a&gt;b{}</style><svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg></body>",
        ]
    );
}

#[test]
fn a_node_iterator_goes_on_after_its_node_is_removed() {
    let mut doc = page();
    let out = logs(
        &mut doc,
        "const d = __blitzParseHTML('<div><a><i></i></a><b></b><c></c></div>');
        const it = d.createNodeIterator(d.querySelector('div'), NodeFilter.SHOW_ELEMENT);
        const seen = [];
        for (let x; (x = it.nextNode()); ) {
            seen.push(x.localName);
            if (x.localName === 'a' || x.localName === 'b') x.remove();
        }
        console.log(seen.join(','), d.querySelector('div').innerHTML);
        const back = [];
        for (let x; (x = it.previousNode()); ) back.push(x.localName);
        console.log(back.join(','));",
    );
    // as the DOM does: removing `a` leaves the iterator after `div`, so `b` comes next
    assert_eq!(out, ["div,a,b,c <c></c>", "c,div"]);
}

#[test]
fn a_parsed_documents_nodes_are_found_and_named_without_asking_again() {
    // DOMPurify reads each node's type and name several times as it walks a chapter parsed as
    // text/html. Each read was a native call, and each wrapper lookup in that document asked
    // natively which document the node is in first: about 20,000 calls for one chapter, most
    // of the sanitizer's half second on a Kindle.
    let mut doc = page();
    let out = logs(
        &mut doc,
        "const d = __blitzParseHTML('<body>' + '<p class=\"c\">one <b>two</b> three</p><svg><rect/></svg>'.repeat(20) + '</body>');
        const calls = new Map();
        for (const k of ['ownedTag', 'kind', 'ns', 'local', 'children']) {
            const f = __n[k];
            __n[k] = (...a) => { calls.set(k, (calls.get(k) || 0) + 1); return f(...a); };
        }
        const walk = () => {
            const it = d.createNodeIterator(d.documentElement, NodeFilter.SHOW_ALL);
            const seen = [];
            for (let x; (x = it.nextNode()); ) {
                if (x.nodeType !== 1) continue;
                const first = x.firstElementChild;
                seen.push(x.nodeName + ':' + x.localName + ':' + x.namespaceURI.slice(-3) + ':' + (first ? first.tagName : '-') + ':' + (x.parentNode.nodeType));
            }
            return seen;
        };
        const before = walk().join(' ');
        calls.clear();
        const again = walk().join(' ');
        console.log(again === before, before.split(' ').slice(0, 6).join(' '));
        console.log(['ownedTag', 'kind', 'ns', 'local', 'children'].map((k) => k + '=' + (calls.get(k) || 0)).join(' '));",
    );
    assert_eq!(
        out,
        [
            "true HTML:html:tml:HEAD:9 HEAD:head:tml:-:1 BODY:body:tml:P:1 P:p:tml:B:1 B:b:tml:-:1 svg:svg:svg:rect:1",
            "ownedTag=0 kind=0 ns=0 local=0 children=0",
        ]
    );
}
