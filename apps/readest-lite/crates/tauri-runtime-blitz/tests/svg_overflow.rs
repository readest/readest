//! An inline `<svg>` clips its content (`svg:not(:root) { overflow: hidden }` in the UA
//! stylesheets of Chromium and Firefox), so as a flex item its automatic minimum size is 0 and it
//! shrinks into a smaller container. Lite's UA stylesheet had no such rule: Readest's icons kept
//! their `width`/`height` attributes and overflowed their buttons, so the sidebar's Close chevron
//! (27.5px in a 24px button) was drawn a quarter too big. Expected values are Chromium's.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const HTML: &str = r#"<!DOCTYPE html><html><head><style>
body { margin: 0; } svg { display: block; }
.col { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 40px; padding: 12px; box-sizing: border-box; min-width: 80px; }
.row { position: absolute; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid; padding: 0; box-sizing: border-box; }
</style></head><body>
<div class="col" style="left: 0; top: 0"><svg id="a" viewBox="0 0 24 24" width="20" height="20"><path d="M3 3h18v18H3z"/></svg></div>
<div class="row" style="left: 100px; top: 0"><svg id="b" viewBox="0 0 24 24" width="27.5" height="27.5"><path d="M3 3h18v18H3z"/></svg></div>
<div style="position: absolute; left: 150px; top: 0; width: 10px"><svg id="c" viewBox="0 0 24 24" width="20" height="20"><path d="M3 3h18v18H3z"/></svg></div>
<div style="position: absolute; left: 200px; top: 0; display: flex; width: 10px"><svg id="d" viewBox="0 0 24 24" width="20" height="20" style="overflow: visible"><path d="M3 3h18v18H3z"/></svg></div>
</body></html>"#;

#[test]
fn an_inline_svg_shrinks_into_its_flex_container() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(HTML, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const e of document.querySelectorAll('svg')) {
            const r = e.getBoundingClientRect();
            console.log([e.id, r.x, r.y, r.width, r.height, getComputedStyle(e).overflowX].join(' '));
        }",
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
            // a column button with 16px of content height: 20x20 shrinks to 20x16
            "a 30 12 20 16 hidden",
            // a 24px button with a 1px border: the 27.5px icon shrinks to its 22px row
            "b 101 -1.75 22 27.5 hidden",
            // not a flex item: keeps its size
            "c 150 0 20 20 hidden",
            // the author's `overflow: visible` keeps the content-based minimum
            "d 200 0 20 20 visible",
        ]
    );
}
