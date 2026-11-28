//! `document.elementFromPoint`: the topmost element at a point of the viewport, the element of
//! the text there, the iframe itself over a frame, the root over no box, and null outside the
//! viewport. Readest's dialogs ask it on Tab whether a layer covers them; Lite had none, so Tab in
//! a dialog threw.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn element_from_point_is_the_topmost_element_there() {
    let html = "<!DOCTYPE html><html style='margin:0'><body style='margin:0; font: 16px/20px Bullet'>\
        <div id='a' style='width: 100px; height: 40px'><span id='s'>••</span></div>\
        <div id='b' style='position: absolute; left: 50px; top: 20px; width: 100px; height: 40px'></div>\
        <iframe id='f' style='position: absolute; left: 200px; top: 0; width: 100px; height: 50px; border: 0' \
          srcdoc=\"<p id='in'>x</p>\"></iframe></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "console.log([[5, 5], [80, 10], [60, 30], [250, 10], [350, 90], [500, 10], [-1, 5]].map(([x, y]) => {
          const e = document.elementFromPoint(x, y);
          return e ? e.id || e.localName : 'null';
        }).join(' '));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    // Chromium's
    assert_eq!(doc.take_messages(), ["log: s a b f html null null"]);
}
