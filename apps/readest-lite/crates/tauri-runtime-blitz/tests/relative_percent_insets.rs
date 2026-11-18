//! A `position: relative` box's percentage `top`/`bottom` resolve against its containing block's
//! height only when that height is definite; otherwise they act as `auto` (CSS 2 §9.4.3, as Chromium
//! does). readest-app's dropdown menus are `relative` with daisyUI's `top: 100%` in an auto-height
//! `<details>`: Blitz resolved it against the menu's own height, so the library's Import menu opened
//! that far down the screen. Expected offsets are Chromium's.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const BODY: &str = r#"
<div style="position:absolute;top:10px;left:0;display:flex"><div id="flexauto" style="position:relative;top:100%;width:50px;height:50px"></div></div>
<div style="position:absolute;top:100px;left:100px"><div id="blockauto" style="position:relative;top:50%;width:40px;height:40px"></div></div>
<div style="position:absolute;top:100px;left:200px"><div id="bottomauto" style="position:relative;bottom:100%;width:40px;height:40px"></div></div>
<div style="position:absolute;top:200px;left:0;height:100px;width:60px"><div id="definite" style="position:relative;top:50%;width:20px;height:20px"></div></div>
<div style="position:absolute;top:200px;left:100px;display:flex;height:100px"><div><div id="stretched" style="position:relative;top:50%;width:20px;height:20px"></div></div></div>
<div style="position:absolute;top:200px;bottom:300px;left:200px"><div id="insets" style="position:relative;top:50%;width:20px;height:20px"></div></div>
"#;

#[test]
fn percentage_offsets_resolve_only_against_a_definite_height() {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{BODY}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 600, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const e of document.querySelectorAll('[id]')) console.log(e.id + ' ' + e.getBoundingClientRect().y)",
        "test",
    );
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            // Auto-height parents: the offset is auto.
            "flexauto 10",
            "blockauto 100",
            "bottomauto 100",
            // Definite heights: by `height`, by stretching in a flex line, by both insets.
            "definite 250",
            "stretched 250",
            "insets 250",
        ]
    );
}
