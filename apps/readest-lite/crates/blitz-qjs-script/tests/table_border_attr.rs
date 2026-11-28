//! A table's `border` attribute, as in Chromium: the table gets that many pixels of outset border
//! (1 for an empty or invalid value, none for 0), its own cells (not a nested table's) 1px inset,
//! all gray unless the table's border color is set. Lite had none: Blitz's UA sheet borders them
//! with Gecko's `:-moz-table-border-nonzero`, which Stylo drops outside Gecko, so tables in books
//! that draw their grid with `border="1"` showed no lines.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

#[test]
fn a_table_s_border_attribute_borders_it_and_its_cells() {
    let html = "<!DOCTYPE html><body style='color: rgb(10, 20, 30)'>\
        <table id=t1 border=1><tr><td id=c1>a</td></tr></table>\
        <table id=t2 border=3><tbody><tr><th id=c2>a</th></tr></tbody></table>\
        <table id=t3 border=0><tr><td id=c3>a</td></tr></table>\
        <table id=t4 border><tr><td id=c4>a</td></tr></table>\
        <table id=t5 border=x><tr><td id=c5>a</td></tr></table>\
        <table id=t6 border=1><tr><td><table><tr><td id=c6>a</td></tr></table></td></tr></table>\
        <table id=t7 border=1 style='border-color: red'><tr><td id=c7>a</td></tr></table></body>";
    let mut doc = QjsDocument::from_html(html, DocumentConfig::default());
    doc.eval(
        "const s = (id) => { const c = getComputedStyle(document.getElementById(id)); return `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`; };
        for (const i of [1, 2, 3, 4, 5, 6, 7]) console.log(`t${i}: ${i === 6 ? '-' : s('t' + i)} | c${i}: ${s('c' + i)}`);",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    // Chromium's
    assert_eq!(
        doc.take_messages(),
        [
            "log: t1: 1px outset rgb(128, 128, 128) | c1: 1px inset rgb(128, 128, 128)",
            "log: t2: 3px outset rgb(128, 128, 128) | c2: 1px inset rgb(128, 128, 128)",
            "log: t3: 0px none rgb(128, 128, 128) | c3: 0px none rgb(10, 20, 30)",
            "log: t4: 1px outset rgb(128, 128, 128) | c4: 1px inset rgb(128, 128, 128)",
            "log: t5: 1px outset rgb(128, 128, 128) | c5: 1px inset rgb(128, 128, 128)",
            "log: t6: - | c6: 0px none rgb(10, 20, 30)",
            "log: t7: 1px outset rgb(255, 0, 0) | c7: 1px inset rgb(255, 0, 0)",
        ]
    );
}
