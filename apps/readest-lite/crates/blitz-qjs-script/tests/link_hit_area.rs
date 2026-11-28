//! Readest's link hit area (`a { position: relative } a::before { position: absolute; inset:
//! -10px }`): as in Chromium, the absolutely positioned `::before` takes no part in the link's
//! client rects, and it covers 10px around the link's own box. The box placed for it in the line
//! sat before the space ahead of the link, and the link's rect and its containing block (so the
//! hit area) reached over that space too. An empty anchor's area still sits around the anchor.
//! The text is bullets in Blitz's built-in Bullet font; Chromium's values are from the same page
//! in a serif font.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn a_link_s_hit_area_is_out_of_its_rects_and_around_its_box() {
    let text = "◦◦ ▪▪ •• ◦◦ ▪▪ •• ◦◦ ▪▪ •• ◦◦ ▪▪ •• ◦◦ ▪▪.";
    let page = format!(
        "<!DOCTYPE html><html><style>body {{ margin: 0; font: 16px/19px Bullet; width: 300px }}
        .h a {{ position: relative }} .h a::before {{ content: ''; position: absolute; inset: -10px }}
        .j {{ text-align: justify }}</style><body>
        <p id=p1 class=h>•• ◦◦ ▪▪ •• ◦◦ ▪▪. <a id=a1>•</a> {text}</p>
        <p id=p2 class='h j'>•• ◦◦ ▪▪ •• ◦◦ ▪▪. <a id=a2>•</a> {text}</p>
        <p id=p3 class=h>•• ◦◦ <a id=a3></a>▪▪ •• ◦◦ ▪▪ {text}</p></body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 400, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&page, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "const at = (x, y) => document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.localName;
        const out = [];
        for (const i of [1, 2]) {
          const a = document.getElementById('a' + i);
          const rg = document.createRange(); rg.selectNodeContents(a.firstChild);
          const t = rg.getBoundingClientRect(); const r = a.getBoundingClientRect(); const y = t.y + t.height / 2;
          out.push(`a${i} own ${Math.abs(r.x - t.x) < 0.5 && Math.abs(r.width - t.width) < 0.5} hits ${at(t.x - 8, y)} ${at(t.x - 12, y)} ${at(t.right + 8, y)} ${at(t.right + 12, y)}`);
        }
        const e = document.getElementById('a3'); const er = e.getBoundingClientRect(); const ey = er.y + er.height / 2;
        out.push(`a3 ${Math.round(er.width)} hits ${at(er.x + 5, ey)} ${at(er.x + 30, ey)} ${at(er.x, er.bottom + 25)}`);
        console.log(out.join(' | '));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    // Chromium's
    assert_eq!(
        doc.take_messages(),
        ["log: a1 own true hits a1 p1 a1 p1 | a2 own true hits a2 p2 a2 p2 | a3 0 hits a3 p3 html"]
    );
}
