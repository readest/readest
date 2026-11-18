//! `scrollIntoView` scrolls an element's scrolling ancestors to show it, aligned as asked
//! (`block`: start, center, end or nearest; `false` is end). readest-app's speed-reading overlay
//! keeps its current word in view this way; QuickJS had no such method, so opening it threw and
//! the app showed its error page. Expected values are Chromium's.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

#[test]
fn scroll_into_view_aligns_as_asked() {
    let html = "<!DOCTYPE html><html style='margin:0'><body style='margin:0'>\
        <div id='s' style='height:100px; width:200px; overflow:auto; border:2px solid black; margin-top:20px'></div>\
        </body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.eval(
        "const s = document.getElementById('s');
        for (let i = 0; i < 20; i++) { const d = document.createElement('div'); d.style.height = '30px'; s.appendChild(d); }",
        "setup",
    );
    doc.inner_mut().resolve(0.0);
    doc.eval(
        r#"const it = (i) => s.children[i];
const out = [];
it(10).scrollIntoView(); out.push(s.scrollTop);
it(10).scrollIntoView({ block: 'center' }); out.push(s.scrollTop);
it(10).scrollIntoView({ block: 'end' }); out.push(s.scrollTop);
s.scrollTop = 0; it(10).scrollIntoView({ block: 'nearest' }); out.push(s.scrollTop);
it(9).scrollIntoView({ block: 'nearest' }); out.push(s.scrollTop);
it(2).scrollIntoView({ block: 'nearest' }); out.push(s.scrollTop);
s.scrollTop = 0; it(10).scrollIntoView(false); out.push(s.scrollTop);
it(19).scrollIntoView({ block: 'start' }); out.push(s.scrollTop);
out.push(document.documentElement.scrollTop);
console.log(out.join(' '));"#,
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(logs, ["300 265 230 230 230 60 230 500 0"]);
}
