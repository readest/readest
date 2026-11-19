//! A flex item's percentage height resolves against its flex container's height only when that
//! height is definite: set by the container's style, or by stretching it in a container with a
//! definite height. A container centred in its line (`align-items: center`) has an indefinite
//! height, so `height: 100%` on its items behaves as `auto`, as in Chromium. Taffy resolved it
//! against the container's measured height, so Readest's library header grouped its buttons in a
//! 36px box where Readest has 32px. Expected values are Chromium's.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const HTML: &str = r#"<!DOCTYPE html><html><head><style>
body { margin: 0; } .hdr { position: absolute; display: flex; height: 52px; padding: 8px 0; box-sizing: border-box; width: 200px; }
.row { display: flex; width: 100%; align-items: center; justify-content: space-between; }
.tall { height: 36px; width: 50px; } .icon { width: 32px; height: 32px; }
.group { display: flex; height: 100%; align-items: center; }
</style></head><body>
<div class="hdr" style="top: 0; align-items: center"><div class="row"><div class="tall"></div><div class="group" id="centered"><div class="icon"></div></div></div></div>
<div class="hdr" style="top: 60px; align-items: stretch"><div class="row"><div class="tall"></div><div class="group" id="stretched"><div class="icon"></div></div></div></div>
<div class="hdr" style="top: 120px; align-items: center"><div class="row" style="height: 40px"><div class="tall"></div><div class="group" id="sized"><div class="icon"></div></div></div></div>
<div class="hdr" style="top: 180px; align-items: center"><div class="row" style="flex-direction: column; align-items: start"><div class="tall"></div><div class="group" id="column"><div class="icon"></div></div></div></div>
</body></html>"#;

#[test]
fn a_percentage_height_needs_a_definite_flex_container_height() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(HTML, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const e of document.querySelectorAll('.group')) {
            const r = e.getBoundingClientRect();
            console.log([e.id, r.y, r.height].join(' '));
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
            // centred in the header: the row's height is indefinite, 100% is auto
            "centered 10 32",
            // stretched to the header's definite 36px
            "stretched 68 36",
            // the row's own height
            "sized 126 40",
            // a column with an auto height
            "column 208 32",
        ]
    );
}
