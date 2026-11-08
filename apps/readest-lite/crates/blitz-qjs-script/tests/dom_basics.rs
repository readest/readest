//! Small DOM pieces readest-app and foliate-js's paginator call on the reader page.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

#[test]
fn replace_children_and_links() {
    let html = "<!DOCTYPE html><html><body><div id='d'><i>a</i>b</div><div id='h'></div>\
        <a href='#x'>1</a><a name='y'>2</a><iframe srcdoc='<a href=\"z\">3</a>'></iframe></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const d = document.getElementById('d');
        const s = document.createElement('span');
        d.replaceChildren(s, 'text');
        console.log(d.childNodes.length, d.firstChild === s, d.lastChild.data);
        d.replaceChildren();
        console.log(d.childNodes.length);
        const root = document.getElementById('h').attachShadow({ mode: 'open' });
        root.append(document.createElement('b'));
        root.replaceChildren(document.createElement('u'), document.createElement('u'));
        console.log(root.childNodes.length, root.firstChild.localName);
        const f = document.querySelector('iframe').contentDocument;
        console.log(document.links.length, document.links[0].getAttribute('href'), f.links.length);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        ["log: 2 true text", "log: 0", "log: 2 u", "log: 1 #x 1"]
    );
}

#[test]
fn normalize_and_canvas_context() {
    let html = "<!DOCTYPE html><html><body><p id='p'>a</p><canvas></canvas></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const p = document.getElementById('p');
        p.append('b', '', 'c');
        const i = document.createElement('i');
        i.append('', '', document.createElement('u'), 'x', 'y');
        p.append(i, '');
        document.body.normalize();
        console.log(p.childNodes.length, p.firstChild.data, i.childNodes.length, i.firstChild.localName, i.lastChild.data);
        console.log(document.querySelector('canvas').getContext('2d'));",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: 2 abc 2 u xy", "log: null"]);
}

#[test]
fn elements_scroll_programmatically() {
    let html = "<!DOCTYPE html><html><body style='margin:0'>\
        <div id='s' style='width:100px; height:50px; overflow:hidden'><div style='width:400px; height:300px'></div></div></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const s = document.getElementById('s');
        let events = 0;
        s.addEventListener('scroll', () => events++);
        s.scrollTop = 40;
        s.scrollLeft = 1000;
        console.log(s.scrollTop, s.scrollLeft, s.scrollHeight, s.scrollWidth);
        s.scrollTo({ top: 10, left: 5 });
        s.scrollBy(1, 2);
        console.log(s.scrollTop, s.scrollLeft);
        s.scrollTo(0, 0);
        setTimeout(() => console.log('events', events), 0);",
        "test",
    );
    doc.run_jobs();
    doc.call_global("__blitzTimers", (1.0e12,));
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: 40 300 300 400", "log: 12 6", "log: events 1"]);
}

#[test]
fn dom_rects() {
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><body style='margin:0'><div id='d' style='width:30px; height:20px'></div></body></html>",
        DocumentConfig::default(),
    );
    doc.eval(
        "const r = new DOMRect(10, 20, -4, 5);
        console.log(r.left, r.right, r.top, r.bottom, r instanceof DOMRectReadOnly, JSON.stringify(DOMRect.fromRect({ x: 1, width: 2 })));
        const b = document.getElementById('d').getBoundingClientRect();
        console.log(b instanceof DOMRect, b.right, b.bottom);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            r#"log: 6 10 20 25 true {"x":1,"y":0,"width":2,"height":0,"top":0,"right":3,"bottom":0,"left":1}"#,
            "log: true 30 20",
        ]
    );
}
