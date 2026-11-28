//! An absolutely positioned block (`position: absolute` with `top: auto`) among a line's inline
//! content sits at the line's top unless inline content comes before it on that line; then it
//! goes below the line, as in Chromium. Readest prepends such a 1x1 skip link to every section's
//! body: in a comic or fixed-layout page, where the body holds only an <img>, Blitz put it below
//! the image.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn an_absolute_block_in_a_line_goes_below_it_only_after_content() {
    let abs = |id: &str| {
        format!("<div id='{id}' style='position: absolute; width: 1px; height: 1px'></div>")
    };
    let bx = "<span style='display: inline-block; vertical-align: top; width: 30px; height: 40px'></span>";
    let html = format!(
        "<!DOCTYPE html><html><body style='margin: 0; font: 10px/20px monospace'>\
         <div id='c1'>{a}{bx}</div><div id='c2'>x{b}y</div><div id='c3'>{bx}{c}</div>\
         <div id='c4'>x<br>{d}y</div><div id='c5'> {e} y</div></body></html>",
        a = abs("a"),
        b = abs("b"),
        c = abs("c"),
        d = abs("d"),
        e = abs("e"),
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "console.log(['c1', 'a', 'c2', 'b', 'c3', 'c', 'c4', 'd', 'c5', 'e'].map((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return `${id} ${r.x},${r.y}`;
        }).join(' | '));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    // Chromium's
    assert_eq!(
        doc.take_messages(),
        [
            "log: c1 0,0 | a 0,0 | c2 0,40 | b 0,60 | c3 0,60 | c 0,100 | c4 0,100 | d 0,120 | c5 0,140 | e 0,140"
        ]
    );
}
