//! Element geometry that layout gives untransformed: `offsetWidth`/`offsetHeight` and the sizes
//! ResizeObserver reports (CSSOM View, Resize Observer). Readest's closed dialogs are scaled to
//! 95%; OverlayScrollbars and react-virtuoso size its lists from ResizeObserver.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

fn run(body: &str, script: &str) -> Vec<String> {
    let html = format!("<!DOCTYPE html><html style='margin:0'><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(&format!("const $ = (id) => document.getElementById(id);\n{script}"), "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

const BOX: &str = "<div id='b' style='width:100px;height:50px;padding:10px;border:2px solid;transform:scale(0.5)'></div>";

#[test]
fn offset_sizes_ignore_transforms() {
    let logs = run(BOX, "console.log($('b').offsetWidth, $('b').offsetHeight, $('b').getBoundingClientRect().width);");
    assert_eq!(logs, ["124 74 62"]);
}

#[test]
fn resize_observer_reports_the_untransformed_content_box() {
    let logs = run(
        BOX,
        "let read = false;
        new ResizeObserver((entries) => {
            const e = entries[0], r = e.contentRect;
            console.log(r.x, r.y, r.width, r.height, e.contentBoxSize[0].inlineSize, e.borderBoxSize[0].inlineSize, e.borderBoxSize[0].blockSize);
        }).observe($('b'), { get box() { read = true; return 'content-box'; } });
        // OverlayScrollbars tests for the box option by reading it
        console.log(read);
        __blitzAfterLayout();",
    );
    assert_eq!(logs, ["true", "10 10 100 50 100 124 74"]);
}

#[test]
fn offset_parent_and_offsets() {
    let logs = run(
        "<div id='p' style='position:relative;margin-left:30px;border:5px solid'>\
           <div id='c' style='margin:7px;width:10.4px;height:10px'></div>\
           <div id='f' style='position:fixed'></div><div style='display:none'><div id='h'></div></div></div>\
         <div id='s' style='margin-left:3px'></div>",
        "const id = (e) => e === null ? 'null' : e.id || e.localName;
        console.log(id($('c').offsetParent), $('c').offsetLeft, $('c').offsetTop, $('c').offsetWidth);
        console.log(id($('s').offsetParent), $('s').offsetLeft, id(document.body.offsetParent), id($('f').offsetParent), id($('h').offsetParent));",
    );
    assert_eq!(logs, ["p 7 7 10", "body 3 null null null"]);
}
