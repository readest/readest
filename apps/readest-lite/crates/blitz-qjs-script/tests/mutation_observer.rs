//! MutationObserver (DOM §4.3): records for child list, attribute and character data changes,
//! delivered in a microtask. OverlayScrollbars sizes its handles when it sees content change;
//! Readest's page-overflow, captured-turn and handwriting hooks react to the reader's DOM.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

fn run(body: &str, script: &str) -> Vec<String> {
    let html = format!("<!DOCTYPE html><html><body>{body}</body></html>");
    let mut doc = QjsDocument::from_html(&html, DocumentConfig::default());
    doc.eval(
        &format!(
            "const $ = (id) => document.getElementById(id);
            const name = (x) => x == null ? 'null' : x.nodeType === 3 ? '#' + x.data : x.id || x.localName;
            const show = (r) => [r.type, name(r.target), r.attributeName ?? '-', r.oldValue ?? '-',
                '+' + [...r.addedNodes].map(name).join(','), '-' + [...r.removedNodes].map(name).join(','),
                name(r.previousSibling), name(r.nextSibling)].join(' ');
            const log = (records) => records.forEach((r) => console.log(show(r)));
            {script}"
        ),
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn child_list_in_a_subtree() {
    let logs = run(
        "<div id='d'><p id='a'></p><p id='b'></p></div><div id='e'></div>",
        "new MutationObserver(log).observe(document.body, { childList: true, subtree: true });
        const s = document.createElement('span'); s.id = 's';
        $('d').insertBefore(s, $('b'));
        $('e').appendChild(s);
        s.remove();
        const f = document.createDocumentFragment();
        f.appendChild(document.createTextNode('x')); f.appendChild(document.createTextNode('y'));
        $('e').append(f);
        $('d').textContent = 'z';
        $('e').innerHTML = '<i id=\"i\"></i>';
        console.log('sync');",
    );
    assert_eq!(
        logs,
        [
            "sync",
            "childList d - - +s - a b",
            "childList d - - + -s a b",
            "childList e - - +s - null null",
            "childList e - - + -s null null",
            "childList e - - +#x,#y - null null",
            "childList d - - +#z -a,b null null",
            "childList e - - +i -#x,#y null null",
        ]
    );
}

#[test]
fn attributes_with_old_values_and_a_filter() {
    let logs = run(
        "<div id='d'></div>",
        "new MutationObserver(log).observe($('d'), { attributeFilter: ['class', 'style'], attributeOldValue: true });
        const d = $('d');
        d.setAttribute('class', 'a');
        d.title = 'ignored'; d.setAttribute('data-x', '1');
        d.classList.add('b');
        d.removeAttribute('class');
        d.removeAttribute('class');
        d.style.setProperty('color', 'red');",
    );
    assert_eq!(
        logs,
        [
            "attributes d class - + - null null",
            "attributes d class a + - null null",
            "attributes d class a b + - null null",
            "attributes d style - + - null null",
        ]
    );
}

#[test]
fn character_data_take_records_and_disconnect() {
    let logs = run(
        "<p id='p'>old</p>",
        "const o = new MutationObserver((r) => { console.log('called'); log(r); });
        o.observe($('p'), { characterDataOldValue: true, subtree: true });
        $('p').firstChild.data = 'new';
        console.log(o.takeRecords().map(show).join('|'));
        $('p').firstChild.nodeValue = 'later';
        o.disconnect();
        $('p').firstChild.data = 'unseen';
        try { o.observe($('p'), {}); } catch (e) { console.log(e.name); }",
    );
    assert_eq!(logs, ["characterData #new - old + - null null", "TypeError"]);
}

#[test]
fn shadow_trees_are_not_in_the_host_subtree() {
    let logs = run(
        "<div id='h'></div>",
        "const root = $('h').attachShadow({ mode: 'open' });
        new MutationObserver(log).observe(document.body, { childList: true, subtree: true });
        root.append(document.createElement('b'));
        $('h').append(document.createElement('u'));",
    );
    assert_eq!(logs, ["childList h - - +u - null null"]);
}

#[test]
fn a_change_in_a_document_nobody_observes_asks_no_ancestors() {
    // a book's section is a document of its own; Readest's observers watch the app's document,
    // and walking up from each changed node of the section to find none cost a Kindle ~30 ms of
    // the alignment classes it sets while opening a book
    let logs = run(
        "<div id='d'></div>",
        "new MutationObserver(log).observe(document.body, { attributes: true, subtree: true });
        const doc = __blitzParseHTML('<html><body><div><div><p id=\"p\">x</p></div></div></body></html>');
        const p = doc.getElementById('p');
        const parent = __n.parent;
        let ups = 0;
        __n.parent = (id) => { ups++; return parent(id); };
        for (let i = 0; i < 10; i++) p.classList.add('c' + i);
        __n.parent = parent;
        console.log('ups', ups);
        // observed, the other document's changes are recorded, and not after a disconnect
        const o = new MutationObserver((rs) => rs.forEach((r) => console.log('doc', show(r))));
        o.observe(doc.body, { attributes: true, subtree: true });
        p.setAttribute('title', 't');
        Promise.resolve().then(() => { o.disconnect(); p.setAttribute('lang', 'en'); $('d').title = 'm'; });",
    );
    assert_eq!(
        logs,
        [
            "ups 0",
            "doc attributes p title - + - null null",
            "attributes d title - + - null null"
        ]
    );
}
