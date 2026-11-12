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

#[test]
fn node_lists_have_item() {
    // react-virtuoso measures a list's rows with `children.item(i)`
    let html = "<!DOCTYPE html><html><body><div id='d'><p>a</p>b<p>c</p></div></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const d = document.getElementById('d');
        console.log(d.children.item(1) === d.lastElementChild, d.children.item(2), d.childNodes.item(1).data);
        console.log(d.querySelectorAll('p').item(0).textContent, document.querySelectorAll('p').item(1).textContent, document.getElementsByTagName('p').item(1).textContent);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: true null b", "log: a c c"]);
}

#[test]
fn computed_writing_mode_is_horizontal() {
    // Layout here is horizontal only. OverlayScrollbars measures a viewport's scroll range by
    // scrolling it to its ends when its writing mode isn't `horizontal-tb`, and took "" for one.
    let html = "<!DOCTYPE html><html><body><div id='d' style='writing-mode:vertical-rl'>x</div></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const s = getComputedStyle(document.body), d = getComputedStyle(document.getElementById('d'));
        console.log(s.writingMode, s.getPropertyValue('writing-mode'), d.writingMode);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: horizontal-tb horizontal-tb horizontal-tb"]);
}

// Settings measures each tab label on a hidden clone of its button (SettingsDialog's
// checkButtonWidths); the footnote popup and Word Lens ruby clone nodes too.
#[test]
fn clone_node() {
    let html = "<!DOCTYPE html><html><body>\
        <button id='b' class='tab' data-x='1'><svg viewBox='0 0 1 1'><path d='M0 0'/></svg><span class='hidden'>Font</span></button>\
        <p id='p'>a<!--c--><i>b</i></p><div id='h'></div></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const b = document.getElementById('b');
        const c = b.cloneNode(true);
        c.style.position = 'absolute';
        const span = c.querySelector('span');
        span.classList.remove('hidden');
        span.textContent = 'Layout';
        document.body.appendChild(c);
        console.log(c !== b, c.parentNode === document.body, c.id, c.className, c.dataset.x, c.childNodes.length);
        console.log(c.firstChild.namespaceURI === 'http://www.w3.org/2000/svg', c.firstChild.firstChild.localName, c.firstChild.firstChild.getAttribute('d'));
        console.log(b.querySelector('span').className, b.querySelector('span').textContent, span.textContent, c.scrollWidth > 0);
        document.body.removeChild(c);
        const shallow = b.cloneNode();
        console.log(shallow.childNodes.length, shallow.getAttribute('class'), shallow.parentNode);
        const p = document.getElementById('p').cloneNode(true);
        console.log(p.childNodes.length, p.childNodes[0].data, p.childNodes[1].nodeType, p.childNodes[1].data, p.textContent);
        const h = document.getElementById('h');
        h.attachShadow({ mode: 'open' }).append(document.createElement('b'));
        h.append('light');
        const hc = h.cloneNode(true);
        console.log(hc.shadowRoot, hc.childNodes.length, hc.textContent, hc.getAttributeNames().join());
        const f = document.createDocumentFragment();
        f.appendChild(document.createElement('u'));
        f.appendChild(document.createTextNode('x'));
        const fc = f.cloneNode(true);
        console.log(fc.nodeType, fc.childNodes.length, fc.firstChild.localName, f.childNodes.length);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: true true b tab 1 2",
            "log: true path M0 0",
            "log: hidden Font Layout true",
            "log: 0 tab null",
            "log: 3 a 8 c ab",
            "log: null 1 light id",
            "log: 11 2 u 2",
        ]
    );
}

// React renders a controlled <select> by walking `select.options` (updateOptions), setting
// `selected`/`defaultSelected` on the option whose value matches; Settings' dropdowns (the Theme
// panel's among them) read `select.value` back in onChange.
#[test]
fn select_options() {
    let html = "<!DOCTYPE html><html><body>\
        <select id='s'><option value='a'>A</option><optgroup label='g'><option>b</option></optgroup><option value='c' selected>C</option></select>\
        <select id='m' multiple><option value='x'>X</option><option value='y'>Y</option></select></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const s = document.getElementById('s');
        const o = s.options;
        console.log(o.length, s.length, o[1].value, o[1].text, s.value, s.selectedIndex, s.multiple);
        for (let i = 0; i < o.length; i++) if (o[i].value === 'a') { o[i].selected = true; o[i].defaultSelected = true; }
        console.log(s.value, s.selectedIndex, o[0].selected, o[2].selected);
        s.value = 'b';
        console.log(s.value, s.selectedIndex, o[0].selected, o[1].selected);
        s.selectedIndex = 2;
        console.log(s.value, o[2].selected, o[1].selected);
        s.value = 'none';
        console.log(s.selectedIndex, s.value === '');
        const m = document.getElementById('m');
        m.options[0].selected = true;
        m.options[1].selected = true;
        console.log(m.multiple, m.options[0].selected, m.options[1].selected, m.value);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: 3 3 b b c 2 false",
            "log: a 0 true false",
            "log: b 1 false true",
            "log: c true false",
            "log: -1 true",
            "log: true true true x",
        ]
    );
}
