//! Floats (CSS 2 §9.5), as books use them: a floated image with the text running beside it, and
//! a drop cap (`::first-letter { float: left }`). Blitz lays floats out only with its `floats`
//! feature, which this crate turns on.

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
    doc.eval(&format!("const $ = (id) => document.getElementById(id).getBoundingClientRect();\n{script}"), "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn text_runs_beside_a_left_float() {
    let logs = run(
        "<div style='width:300px;font-size:16px;line-height:20px'>\
           <div id='f' style='float:left;width:100px;height:50px'></div>\
           <span id='t'>words</span> beside it</div><p id='after' style='margin:0;clear:left'>x</p>",
        "const f = $('f'), t = $('t');
        console.log(f.x, f.y, t.x, $('after').y);",
    );
    assert_eq!(logs, ["0 0 100 50"]);
}
