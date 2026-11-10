//! Range, TreeWalker and tree order in bootstrap.js: foliate-js's CFIs, progress and text walker
//! work on them.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

fn run(script: &str) -> (Vec<String>, Vec<String>) {
    let html = "<!DOCTYPE html><html><body>\
        <div id='a'><p id='p1'>one <b id='b'>two</b> three</p><!--c--><p id='p2'>four</p></div>\
        <div id='z'>five</div></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        &format!(
            "const $ = (id) => document.getElementById(id);
            const t1 = $('p1').firstChild, bt = $('b').firstChild, t3 = $('p1').lastChild;
            {script}"
        ),
        "test",
    );
    doc.run_jobs();
    let logs = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned));
    (logs.collect(), doc.take_js_errors())
}

#[test]
fn tree_order() {
    let (logs, errors) = run("
        console.log($('p1').compareDocumentPosition($('p2')), $('p2').compareDocumentPosition($('p1')));
        console.log($('a').compareDocumentPosition(bt), bt.compareDocumentPosition($('a')), $('z').compareDocumentPosition(t3));
        console.log(t1.compareDocumentPosition(t1), t1.compareDocumentPosition(document.createElement('i')) & 1);
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["4 2", "20 10 2", "0 1"]);
}

#[test]
fn range_boundaries() {
    let (logs, errors) = run("
        const r = document.createRange();
        console.log(r.startContainer === document, r.startOffset, r.collapsed, r instanceof Range);
        r.setStart(t1, 2);
        r.setEnd(t3, 3);
        console.log(r.collapsed, r.commonAncestorContainer === $('p1'), JSON.stringify(r.toString()));
        // moving the start past the end collapses the range there
        const c = r.cloneRange();
        c.setStart($('p2'), 0);
        console.log(c.collapsed, c.endContainer === $('p2'), r.endContainer === t3);
        // epubcfi.js toRange
        const s = document.createRange();
        s.setStartBefore($('b'));
        s.setEndAfter($('b'));
        console.log(s.startContainer === $('p1'), s.startOffset, s.endOffset, s.toString());
        s.selectNodeContents($('p1'));
        console.log(s.startOffset, s.endOffset, s.toString());
        s.selectNode($('p2'));
        console.log(s.startContainer === $('a'), s.startOffset, s.endOffset);
        s.collapse(true);
        console.log(s.collapsed, s.endOffset);
        // progress.js / text-walker.js
        console.log(r.comparePoint(t1, 1), r.comparePoint(t1, 2), r.comparePoint(bt, 0), r.comparePoint(t3, 4), r.comparePoint($('p2'), 0));
        console.log(r.isPointInRange(bt, 1), r.intersectsNode($('b')), r.intersectsNode($('p2')));
        // paginator.js
        const x = document.createRange();
        x.selectNodeContents(bt);
        console.log(r.compareBoundaryPoints(Range.START_TO_START, x), r.compareBoundaryPoints(Range.END_TO_END, x), x.compareBoundaryPoints(Range.START_TO_END, r), r.compareBoundaryPoints(Range.END_TO_START, x));
        try { r.setStart(t1, 99); } catch (e) { console.log(e.name); }
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "true 0 true true",
            "false true \"e two th\"",
            "true true true",
            "true 1 2 two",
            "0 3 one two three",
            "true 2 3",
            "true 2",
            "-1 0 0 1 1",
            "true true false",
            "-1 1 1 -1",
            "IndexSizeError",
        ]
    );
}

// foliate-js measures every text node on a page turn (a range over its contents, then its box):
// each boundary point set walked the tree several times, a native call a step, ~0.4 ms a range.
#[test]
fn setting_a_boundary_point_walks_up_once_from_each_point() {
    let (logs, errors) = run("
        const get = Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode').get;
        let reads = 0;
        Object.defineProperty(Node.prototype, 'parentNode', { get() { reads++; return get.call(this); }, configurable: true });
        const r = document.createRange();
        r.selectNodeContents(bt);
        const select = reads;
        reads = 0;
        // bt is 7 steps from the top (b, p1, a, body, html, document, null), t1 6
        r.setStart(t1, 1);
        console.log(select, reads, r.startContainer === t1, r.endContainer === bt);
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["0 13 true true"]);
}

#[test]
fn a_nodes_index_does_not_walk_its_earlier_siblings() {
    // foliate-js compares the reading position with each print-page marker of a section
    // (comparePoint). Each comparison found a paragraph's index by reading every sibling before
    // it, a native call and a wrapper each: deep into a long chapter, a turn's progress took
    // most of half a second on a Kindle.
    let (logs, errors) = run("
        for (let i = 0; i < 200; i++) {
            const p = document.createElement('p');
            p.id = 'n' + i;
            document.body.append(p);
        }
        const get = Object.getOwnPropertyDescriptor(Node.prototype, 'previousSibling').get;
        let reads = 0;
        Object.defineProperty(Node.prototype, 'previousSibling', { get() { reads++; return get.call(this); }, configurable: true });
        const r = document.createRange();
        r.setStart($('n100'), 0);
        reads = 0;
        console.log(r.comparePoint($('n150'), 0), r.comparePoint($('n50'), 0), reads);
        // a shadow host's shadow root is its first native child, not one of its child nodes
        const host = $('z');
        host.attachShadow({ mode: 'open' });
        const i = document.createElement('i');
        host.append(i);
        const s = document.createRange();
        s.setStartBefore(i);
        console.log(s.startOffset, host.childNodes.length, host.childNodes[s.startOffset] === i);
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(logs, ["1 -1 0", "1 2 true"]);
}

#[test]
fn tree_walker() {
    let (logs, errors) = run("
        const names = (w) => { const out = []; for (let n; (n = w.nextNode()); ) out.push(n.nodeType === 3 ? n.data.trim() : n.nodeName); return out.join(','); };
        console.log(names(document.createTreeWalker($('a'), NodeFilter.SHOW_TEXT)));
        console.log(names(document.createTreeWalker($('a'), NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT)));
        // REJECT skips the subtree, SKIP only the node
        const f = (n) => (n.id === 'b' ? NodeFilter.FILTER_REJECT : n.id === 'p2' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT);
        console.log(names(document.createTreeWalker($('a'), NodeFilter.SHOW_ALL, f)));
        console.log(names(document.createTreeWalker($('a'), NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.includes('o') ? 1 : 3) })));
        const w = document.createTreeWalker($('a'), NodeFilter.SHOW_TEXT);
        w.currentNode = $('p2').firstChild;
        const back = [];
        for (let n; (n = w.previousNode()); ) back.push(n.data.trim());
        console.log(back.join(','), w.currentNode === t1);
        const e = document.createTreeWalker($('a'), NodeFilter.SHOW_ELEMENT);
        console.log(e.firstChild().id, e.nextSibling().id, e.nextSibling(), e.previousSibling().id, e.firstChild().id, e.parentNode().id, e.parentNode().id, e.parentNode(), e.lastChild().id);
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "one,two,three,four",
            "P,B,#comment,P",
            "P,one,three,#comment,four",
            "one,two,four",
            "three,two,one true",
            "p1 p2 null p1 b p1 a null p2",
        ]
    );
}

#[test]
fn ranges_in_an_iframe_document() {
    let html = "<!DOCTYPE html><html><body><iframe srcdoc='<p>hi</p>'></iframe></body></html>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const d = document.querySelector('iframe').contentDocument;
        const r = d.createRange();
        r.selectNodeContents(d.body);
        const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
        console.log(r.startContainer === d.body, r.toString(), w.nextNode().data, d.defaultView.Range === Range);
        console.log(d.defaultView.getSelection() === d.getSelection(), d.getSelection() !== document.getSelection());",
        "test",
    );
    let logs: Vec<_> = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    assert_eq!(logs, ["log: true hi hi true", "log: true true"]);
}

#[test]
fn selection_holds_a_range_per_document() {
    let (logs, errors) = run("
        const s = window.getSelection();
        console.log(s === document.getSelection(), s.rangeCount, s.anchorNode, s.isCollapsed, s.type);
        const r = document.createRange();
        r.setStart(t1, 1);
        r.setEnd(bt, 2);
        s.addRange(r);
        console.log(s.rangeCount, s.getRangeAt(0) === r, s.anchorNode === t1, s.anchorOffset, s.focusNode === bt, s.focusOffset, s.isCollapsed, s.type, s.toString());
        s.collapse(t3, 2);
        console.log(s.rangeCount, s.isCollapsed, s.anchorNode === t3, s.focusOffset, s.type);
        s.removeAllRanges();
        console.log(s.rangeCount, s.anchorNode);
        try { s.getRangeAt(0); } catch (e) { console.log(e.name); }
    ");
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        logs,
        [
            "true 0 null true None",
            "1 true true 1 true 2 false Range ne tw",
            "1 true true 2 Caret",
            "0 null",
            "IndexSizeError",
        ]
    );
}
