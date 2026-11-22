//! A `<br>`'s client rect is a zero-width box where its line ends: right after the text before it
//! on that line (at the line's start when the line holds nothing else), with the top and height of
//! that line's text, as in Chromium. Lite gave every `<br>` an empty box at its paragraph's start,
//! so a script measuring a line break (or a range across one) got the wrong place.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const HTML: &str = r#"<!DOCTYPE html><html><head><style>
body { margin: 0; } p { margin: 0; position: absolute; left: 10px; top: 10px; width: 300px; font: 16px/30px sans-serif; }
</style></head><body>
<p><span id="a">one</span><br id="b1"><span id="c">two words</span><br id="b2"><br id="b3">end</p>
</body></html>"#;

#[test]
fn a_br_sits_where_its_line_ends() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(HTML, config);
    doc.inner_mut().resolve(0.0);
    // Each <br> against the text it follows (Chromium: a 10 16 26.7 17, b1 36.7 16 0 17,
    // c 10 46 72.03 17, b2 82.03 46 0 17, b3 10 76 0 17).
    doc.eval(
        "const r = (id) => document.getElementById(id).getBoundingClientRect();
        const [a, b1, c, b2, b3] = ['a', 'b1', 'c', 'b2', 'b3'].map(r);
        const near = (x, y) => Math.abs(x - y) < 0.5;
        console.log([
            near(b1.x, a.right) && near(b1.y, a.y) && near(b1.height, a.height) && b1.width === 0,
            near(b2.x, c.right) && near(b2.y, c.y) && near(b2.height, c.height) && b2.width === 0,
            near(b3.x, 10) && near(b3.y, c.y + 30) && near(b3.height, c.height) && b3.width === 0,
        ].join(' ') + ' | ' + [b1, b2, b3].map((b) => [b.x, b.y, b.width, b.height].join(',')).join(' '));",
        "test",
    );
    let log = doc
        .take_messages()
        .into_iter()
        .find_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .unwrap();
    assert!(log.starts_with("true true true |"), "<br> rects: {log}");
}
