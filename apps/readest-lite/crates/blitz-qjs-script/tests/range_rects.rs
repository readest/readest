//! Range geometry: the boxes of the text a range covers (foliate-js finds the visible range,
//! draws highlights and places popups from them), compared with the boxes of elements that hold
//! the same text, so that no font metric is assumed. The text is bullets in Blitz's built-in
//! bullet font (the only font a document has without system or bundled fonts).

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

fn run(body: &str, html_style: &str, script: &str) -> Vec<String> {
    let html = format!(
        "<!DOCTYPE html><html style='margin:0; {html_style}'><body style='margin:0; font: 16px/20px Bullet'>{body}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        &format!(
            "const $ = (id) => document.getElementById(id);
            const box = (r) => [r.x, r.y, r.width, r.height].map((v) => Math.round(v)).join(',');
            const range = (n, s, e, m = n) => {{ const r = document.createRange(); r.setStart(n, s); r.setEnd(m, e); return r; }};
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
fn a_range_in_a_text_node_has_the_box_of_its_text() {
    // `a`'s text is "•• ◦◦ ▪▪"; `b` holds "◦◦" alone where it sits in `c`'s text
    let logs = run(
        "<p id='a' style='margin:0'>•• ◦◦ ▪▪</p>\
         <p id='c' style='margin:0'>•• <span id='b'>◦◦</span> ▪▪</p>",
        "",
        "const t = $('a').firstChild;
        const b = $('b').getBoundingClientRect();
        const r = range(t, 3, 5).getBoundingClientRect();
        console.log(box(r) === box(new DOMRect(b.x, b.y - 20, b.width, b.height)), r.width > 0, r.width < $('a').getBoundingClientRect().width);
        console.log(range(t, 3, 5).getClientRects().length);
        // a collapsed range is a caret: no width, the font's content area (an inline box's
        // height, as in browsers), where the text is
        const c = range(t, 3, 3).getBoundingClientRect();
        console.log(c.width, c.height === b.height && c.height < 20, Math.round(c.x) === Math.round(b.x));",
    );
    assert_eq!(logs, ["true true true", "1", "0 true true"]);
}

#[test]
fn collapsed_white_space_is_skipped_by_offsets() {
    // the DOM keeps the run of spaces and the newline; the line holds one space
    let logs = run(
        "<p id='a' style='margin:0'>••   \n  ◦◦</p><p id='c' style='margin:0'>•• <span id='b'>◦◦</span></p>",
        "",
        "const t = $('a').firstChild;
        const b = $('b').getBoundingClientRect();
        const r = range(t, 8, 10).getBoundingClientRect();
        console.log(Math.round(r.x) === Math.round(b.x), Math.round(r.width) === Math.round(b.width));",
    );
    assert_eq!(logs, ["true true"]);
}

#[test]
fn a_range_over_wrapped_text_has_a_box_per_line() {
    let logs = run(
        "<p id='a' style='margin:0; width:1px'>•••• ◦◦◦◦ ▪▪▪▪</p><p style='margin:0'><span id='m'>•</span></p>",
        "",
        "const t = $('a').firstChild;
        // each line's box is the font's content area, `dy` below the line's top (an inline box)
        const m = $('m').getBoundingClientRect(), dy = m.y - 60;
        const rects = [...range(t, 0, 14).getClientRects()];
        console.log(rects.length, rects.map((r) => r.y - dy).join(' '), rects.every((r) => r.height === m.height && r.width > 0));
        const all = range(t, 0, 14).getBoundingClientRect();
        console.log(all.y - dy, all.height - m.height);",
    );
    assert_eq!(logs, ["3 0 20 40 true", "0 40"]);
}

#[test]
fn a_range_across_elements_covers_their_text() {
    // from inside the first text node to inside the last: the selected text and the <b> box
    let logs = run(
        "<p id='a' style='margin:0'>•• <b id='b'>◦◦</b> ▪▪</p>",
        "",
        "const p = $('a');
        const r = range(p.firstChild, 1, 2, p.lastChild);
        const b = $('b').getBoundingClientRect();
        const x = r.getBoundingClientRect();
        console.log(x.x < b.x, x.x + x.width > b.x + b.width, x.y === b.y, x.height === b.height);
        console.log(r.getClientRects().length);
        // a range selecting an element's contents has the element's text box
        const s = document.createRange();
        s.selectNodeContents($('b'));
        console.log(box(s.getBoundingClientRect()) === box(b));
        // the text boxes meet the <b> box (each node's collapsed space is its own)
        const rs = r.getClientRects(), round = Math.round;
        console.log(round(rs[0].right) === round(b.left), box(rs[2]) === box(b), round(rs[3].left) === round(b.right));",
    );
    // "• ", the <b> element, its text "◦◦" and " ▪" (CSSOM View: selected elements and texts)
    assert_eq!(logs, ["true true true true", "4", "true", "true true true"]);
}

#[test]
fn text_in_columns_is_in_its_column() {
    // two 20px lines per 100px column, columns 120px apart: line 3 is the second column's
    // second line
    let lines: String = (0..6)
        .map(|i| format!("<div id='l{i}' style='height:20px'><span id='m{i}'>•••</span></div>"))
        .collect();
    let logs = run(
        &lines,
        "width:100px; height:40px; padding:0 10px; column-width:100px; column-gap:20px; column-fill:auto; overflow:hidden",
        "const t = $('m3').firstChild;
        // the last two of its three bullets: right of the column's left edge (130), in it, on
        // the column's second line (its box the font's content area, as the first line's span)
        const m = $('m0').getBoundingClientRect();
        const r = range(t, 1, 3).getBoundingClientRect();
        console.log(r.x > 130 && r.x + r.width <= 230, r.y === 20 + m.y, r.height === m.height);",
    );
    assert_eq!(logs, ["true true true"]);
}

// The rule `getClientRects` follows (CSSOM View), from public DOM calls: the boxes of each element
// the range selects whose parent it does not select, and of each text node it selects or partly
// selects, in tree order.
const SELECTION_ORACLE: &str = "
    const selected = (r, x) => {
        const p = x.parentNode;
        if (!p) return false;
        const i = [...p.childNodes].indexOf(x);
        return r.comparePoint(p, i) === 0 && r.comparePoint(p, i + 1) === 0;
    };
    const expected = (r) => {
        const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = r;
        const text = (t, s, e) => [...range(t, s, e).getClientRects()];
        if (sc === ec && sc.nodeType === 3) return text(sc, so, eo);
        const out = sc.nodeType === 3 ? text(sc, so, sc.length) : [];
        const w = document.createTreeWalker(r.commonAncestorContainer, 0x5);
        for (let x; (x = w.nextNode()); ) {
            if (x === sc || x === ec || !selected(r, x)) continue;
            if (x.nodeType === 3) out.push(...text(x, 0, x.length));
            else if (!selected(r, x.parentNode)) out.push(...x.getClientRects());
        }
        if (ec.nodeType === 3) out.push(...text(ec, 0, eo));
        return out;
    };
    const same = (r) => {
        const a = [...r.getClientRects()].map(box).join(' '), b = expected(r).map(box).join(' ');
        return a === b || `${a} != ${b}`;
    };";

#[test]
fn a_range_has_the_boxes_of_what_it_selects() {
    // nested inline and block content, ranges from text to text, element to element, whole
    // contents, and boundaries at different depths
    let logs = run(
        "<div id='d'><p id='a' style='margin:0'>•• <b id='b'>◦◦ <i id='i'>▪▪</i></b> ▪▪</p>\
         <p id='c' style='margin:0'>◦◦<span id='s'>••</span></p><!-- c --><p id='e' style='margin:0'>▪</p></div>",
        "",
        &format!(
            "{SELECTION_ORACLE}
            const d = $('d'), a = $('a'), b = $('b'), i = $('i'), c = $('c');
            const whole = document.createRange();
            whole.selectNodeContents(document.body);
            const shapes = [
                whole,
                range(a.firstChild, 1, 1, c.firstChild),
                range(b.firstChild, 2, 1, i.firstChild),
                range(d, 0, 2),
                range(d, 1, 4),
                range(a, 1, 1, $('s')),
                range(i.firstChild, 0, 1, $('e').firstChild),
                range(document.body, 0, 1, b),
            ];
            console.log(shapes.map(same).join(','));"
        ),
    );
    assert_eq!(logs, ["true,true,true,true,true,true,true,true"]);
}

#[test]
fn measuring_a_long_chapter_visits_each_node_a_bounded_number_of_times() {
    // foliate-js sizes a section from the box of a range over its whole body: 400 paragraphs
    // must not cost each paragraph a walk over the ones before it (a Kindle spent seconds there)
    let paragraphs = "<p style='margin:0'>•• <b>◦◦</b></p>".repeat(400);
    let logs = run(
        &paragraphs,
        "",
        "const get = Object.getOwnPropertyDescriptor(Node.prototype, 'previousSibling').get;
        let reads = 0;
        Object.defineProperty(Node.prototype, 'previousSibling', {
            get() { reads++; return get.call(this); }, configurable: true,
        });
        const r = document.createRange();
        r.selectNodeContents(document.body);
        const h = r.getBoundingClientRect().height;
        console.log(h > 0, reads <= 4 * 400 * 4);",
    );
    assert_eq!(logs, ["true true"]);
}
