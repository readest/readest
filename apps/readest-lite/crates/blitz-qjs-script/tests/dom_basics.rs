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

#[test]
fn document_title_is_written() {
    // readest-app names the page after the open book (BooksGrid): with no setter, the assignment
    // threw in the bundle's strict code and took the reader down.
    for (head, before) in [("<title>Readest</title>", "Readest"), ("", "")] {
        let html = format!("<!DOCTYPE html><html><head>{head}</head><body></body></html>");
        let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
        doc.eval(
            "(() => {
                'use strict';
                console.log(JSON.stringify(document.title));
                document.title = 'Dune  Messiah ';
                const t = document.querySelectorAll('title');
                console.log(document.title, t.length, t[0].parentNode.localName);
            })();",
            "test",
        );
        assert_eq!(doc.take_js_errors(), Vec::<String>::new());
        assert_eq!(
            doc.take_messages(),
            [
                format!("log: \"{before}\""),
                "log: Dune Messiah 1 head".into()
            ]
        );
    }
}

#[test]
fn last_element_child_does_not_list_the_children() {
    // Readest puts a chapter's next-section skip link in its last element, found by following
    // lastElementChild down from <body>: through a parent of hundreds of paragraphs, that must
    // not list them all (a Kindle spent ~40 ms there opening a book at a chapter)
    let html = format!(
        "<!DOCTYPE html><html><body><div id='d'>{}<b>x</b> text <!--c--></div>\
        <div id='e'> <!--c--> </div></body></html>",
        "<p>p</p>\n".repeat(400)
    );
    let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
    doc.eval(
        "const children = __n.children;
        let listed = 0;
        __n.children = (id) => { const c = children(id); listed += c.length; return c; };
        const last = document.getElementById('d').lastElementChild;
        const none = document.getElementById('e').lastElementChild;
        __n.children = children;
        const host = document.createElement('div');
        host.attachShadow({ mode: 'open' }).append(document.createElement('i'));
        const empty = host.lastElementChild;
        host.append(document.createElement('u'), 'text');
        console.log(last.localName, listed, none, empty, host.lastElementChild.localName);",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: b 0 null null u"]);
}

#[test]
fn children_asks_nothing_of_the_text_between_elements() {
    // foliate-js resolves a CFI step from a parent's `children`: a chapter's parent of hundreds of
    // paragraphs and the white space between them, where asking each child its type is a native
    // call (a Kindle spent ~50 ms of opening a book at a saved page there)
    let html = format!(
        "<!DOCTYPE html><html><body><div id='d'>{}<b>x</b> text <!--c--></div></body></html>",
        "<p>p</p>\n".repeat(400)
    );
    let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
    doc.eval(
        "const d = document.getElementById('d');
        const els = (n) => [...n.childNodes].filter((c) => c.nodeType === 1);
        const same = (n) => { const a = [...n.children], b = els(n); return a.length === b.length && a.every((c, i) => c === b[i]); };
        d.children; // the paragraphs' objects made once
        const kind = __n.kind;
        let asked = 0;
        __n.kind = (id) => { asked++; return kind(id); };
        const c = d.children;
        __n.kind = kind;
        const host = document.createElement('div');
        host.attachShadow({ mode: 'open' }).append(document.createElement('i'));
        host.append(document.createElement('u'), 'text', document.createElement('s'));
        console.log(c.length, c[400].localName, c.item(0).localName, asked, same(d), same(host), [...host.children].map((e) => e.localName).join());",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: 401 b p 0 true true u,s"]);
}

// Readest adds an alignment class to each paragraph of a chapter as it loads (keepTextAlignment),
// a few hundred `classList.add`s on a Kindle's path to the page.
#[test]
fn class_list() {
    let html =
        "<!DOCTYPE html><html><body><p id='p' class='a  b\tc a'>x</p><p id='q'>y</p></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const p = document.getElementById('p'), q = document.getElementById('q');
        console.log(p.classList === p.classList, p.classList.contains('b'), p.classList.contains('d'));
        p.classList.add('d', 'a');
        console.log(p.className);
        p.classList.remove('b', 'x');
        console.log(p.className);
        console.log(p.classList.toggle('a'), p.classList.toggle('e', true), p.classList.toggle('e', true), p.className);
        q.classList.remove('a');
        console.log(q.hasAttribute('class'));
        q.classList.add('z');
        console.log(q.className, q.classList.contains('z'));",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: true true false",
            "log: a b c d",
            "log: a c d",
            "log: false true true c d e",
            "log: false",
            "log: z true",
        ]
    );
}

// A fragment's children are its children for walks over it (Readest reads a selection's text
// with a TreeWalker over `range.cloneContents()`): their parent is the fragment, their siblings
// are each other, until they leave it.
#[test]
fn a_fragments_children_link_to_it_and_each_other() {
    let html = "<!DOCTYPE html><html><body></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const f = document.createDocumentFragment();
        const [a, b, c] = [document.createElement('i'), document.createTextNode('x'), document.createElement('b')];
        for (const k of [a, b, c]) f.appendChild(k);
        console.log(a.parentNode === f, a.nextSibling === b, c.previousSibling === b, c.nextSibling, a.previousSibling);
        b.remove();
        console.log(a.nextSibling === c, f.childNodes.length, b.parentNode, b.nextSibling);
        document.body.appendChild(a);
        console.log(a.parentNode === document.body, f.firstChild === c, c.previousSibling, a.nextSibling);
        document.body.appendChild(f);
        console.log(c.parentNode === document.body, a.nextSibling === c, f.childNodes.length);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: true true true null null",
            "log: true 2 null null",
            "log: true true null null",
            "log: true true 0",
        ]
    );
}

// Readest's vocabulary reads a range's text with `fragment.querySelectorAll('rt, rp')` removed
// and then `fragment.textContent`.
#[test]
fn a_fragment_is_queried_and_read_as_a_parent_node() {
    let html = "<!DOCTYPE html><html><body></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const f = document.createDocumentFragment();
        const p = document.createElement('p');
        p.innerHTML = 'a<rt>x</rt>b';
        f.append(p, 'c', document.createComment('z'));
        console.log(f.querySelectorAll('rt').length, f.querySelector('p') === p, f.querySelector('i'), f.textContent);
        console.log(f.children.length, f.childElementCount, f.firstElementChild === p, f.lastElementChild === p);
        f.querySelectorAll('rt, rp').forEach((el) => el.remove());
        console.log(f.textContent);
        f.textContent = 'd';
        console.log(f.childNodes.length, f.firstChild.data);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: 1 true null axbc",
            "log: 1 1 true true",
            "log: abc",
            "log: 1 d"
        ]
    );
}

// Readest's Wiktionary lookup unwraps links with `link.replaceWith(...link.childNodes)` and marks
// the section it shows with `lang` and `dir`.
#[test]
fn nodes_go_before_after_or_in_place_of_a_child() {
    let html = "<!DOCTYPE html><html><body><p id='p'><a id='a'>x<b>y</b></a><i id='i'>z</i></p></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const [p, a, i] = ['p', 'a', 'i'].map((id) => document.getElementById(id));
        a.replaceWith(...Array.from(a.childNodes));
        console.log(p.innerHTML, a.parentNode);
        i.before('1', document.createElement('u'));
        i.after('2');
        console.log(p.innerHTML);
        // a node among its own replacements keeps its place among them
        i.replaceWith(i, 'w');
        console.log(p.innerHTML);
        const s = document.createElement('section');
        s.lang = 'de';
        s.dir = 'rtl';
        console.log(s.lang, s.dir, s.outerHTML);",
        "test",
    );
    let logs = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "log: x<b>y</b><i id=\"i\">z</i> null",
            "log: x<b>y</b>1<u></u><i id=\"i\">z</i>2",
            "log: x<b>y</b>1<u></u><i id=\"i\">z</i>w2",
            "log: de rtl <section lang=\"de\" dir=\"rtl\"></section>",
        ]
    );
}

#[test]
fn documents_are_in_standards_mode() {
    // Blitz styles every document without quirks; KaTeX refuses to render (and warns at every
    // start of Readest) on a page whose compatMode isn't CSS1Compat.
    let html = "<!DOCTYPE html><html><body><iframe srcdoc='<p>x</p>'></iframe></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "console.log(document.compatMode, document.querySelector('iframe').contentDocument.compatMode);",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(doc.take_messages(), ["log: CSS1Compat CSS1Compat"]);
}
