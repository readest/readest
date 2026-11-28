//! Table rows and row groups have boxes, as in Chromium: a row spans the grid's columns at its row's
//! height, a row group spans its rows. Blitz lays out only a table's cells, so their client rects
//! were 0,0,0,0: Readest's capture of a page with a table, a link to a row and a selection's rects
//! over a table all lacked them.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn rows_and_row_groups_have_client_rects() {
    // separate borders with a short row; collapsed borders (a row reaches the middle of the
    // borders around it) with a rowspan; a tfoot and thead written around the tbody (laid out head,
    // body, foot)
    let page = "<!DOCTYPE html><body style='margin:0; font: 10px/10px monospace'>\
        <table id=t1 style='margin:5px; border:1px solid; border-spacing:2px'><tbody id=g1>\
          <tr id=r1><td style='width:20px; height:10px'></td><td style='width:30px; height:10px'></td></tr>\
          <tr id=r2><td style='height:14px'></td></tr></tbody></table>\
        <table id=t2 style='margin:5px; border-collapse:collapse; border:2px solid'>\
          <tr id=r3><td style='border:2px solid; width:20px; height:10px' rowspan=2></td><td style='border:2px solid; width:10px; height:10px'></td></tr>\
          <tr id=r4><td style='border:2px solid; height:10px'></td></tr></table>\
        <table id=t3 style='margin:5px; border-spacing:3px'><tfoot id=f3><tr id=r5><td style='width:10px; height:5px'></td></tr></tfoot>\
          <tbody id=g3><tr id=r6><td style='width:10px; height:8px'></td></tr><tr id=r7><td style='height:9px'></td></tr></tbody>\
          <thead id=h3><tr id=r8><td style='height:6px'></td></tr></thead></table></body>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(page, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "const ids = ['t1', 'g1', 'r1', 'r2', 't2', 'r3', 'r4', 't3', 'f3', 'r5', 'g3', 'r6', 'r7', 'h3', 'r8'];
        console.log(ids.map((id) => {
          const el = document.getElementById(id); const r = el.getBoundingClientRect();
          return `${id}=${[r.x, r.y, r.width, r.height].join(',')}/${el.getClientRects().length}`;
        }).join(' '));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    // Chromium's
    assert_eq!(
        doc.take_messages(),
        [
            "log: t1=5,5,62,36/1 g1=8,8,56,30/1 r1=8,8,56,12/1 r2=8,22,56,16/1 \
             t2=5,46,40,30/1 r3=6,47,38,14/1 r4=6,61,38,14/1 \
             t3=5,81,18,51/1 f3=8,122,12,7/1 r5=8,122,12,7/1 g3=8,95,12,24/1 r6=8,95,12,10/1 r7=8,108,12,11/1 h3=8,84,12,8/1 r8=8,84,12,8/1"
        ]
    );
}
