//! A scroll container's scrollable overflow reaches the margin edge of its last in-flow child,
//! plus its own end padding, as Chromium does: the child's bottom margin, or the margin collapsed
//! through it from its own last child, stays below the content when scrolled to the end. Lite
//! stopped at the child's border box, so Readest's Settings dialog (whose content ends with
//! `my-4`) scrolled 16px less than Readest and drew a longer thumb. Expected values are
//! Chromium's.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const HTML: &str = r#"<!DOCTYPE html><html><head><style>
body { margin: 0; } .s { position: absolute; top: 0; width: 80px; height: 100px; overflow: auto; scrollbar-width: none; }
.h { height: 300px; }
</style></head><body>
<div class="s" id="own" style="left: 0"><div class="h" style="margin-bottom: 20px"></div></div>
<div class="s" id="through" style="left: 100px"><div><div class="h" style="margin: 16px 0"></div></div></div>
<div class="s" id="padded" style="left: 200px; padding-bottom: 10px"><div class="h" style="margin-bottom: 20px"></div></div>
<div class="s" id="flex" style="left: 300px; display: flex; flex-direction: column"><div class="h" style="flex: none; margin-bottom: 20px"></div></div>
<div class="s" id="negative" style="left: 400px"><div class="h" style="margin-bottom: -20px"></div></div>
<div class="s" id="sibling" style="left: 500px"><div class="h" style="margin-bottom: 30px"></div><div style="height: 10px; margin-top: 10px"></div></div>
<div class="s" id="none" style="left: 600px"><div class="h"></div></div>
<div class="s" id="bfc" style="left: 700px"><div style="display: flow-root"><div class="h" style="margin-bottom: 20px"></div></div></div>
</body></html>"#;

#[test]
fn scrollable_overflow_ends_at_the_last_childs_margin_edge() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(900, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(HTML, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const e of document.querySelectorAll('.s')) console.log(e.id + ' ' + e.scrollHeight);",
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
            "own 320",
            "through 332",
            "padded 330",
            "flex 320",
            "negative 300",
            "sibling 340",
            "none 300",
            "bfc 320",
        ]
    );
}
