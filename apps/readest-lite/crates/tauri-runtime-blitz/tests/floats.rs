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

#[test]
fn a_floated_first_letter_is_a_drop_cap() {
    // As the novel's chapter openings: `p::first-letter { font-size: 2.6em; line-height: 0.85;
    // float: left }` after the white space that starts the paragraph's text.
    let logs = run(
        "<style>p::first-letter { font-size: 2.6em; line-height: 0.85; float: left }</style>\
         <p id='p' style='margin:0;width:200px;font-size:16px;line-height:20px'>\n\t\tPaul sat on the edge of his bed and began stripping off his desert boots.</p>",
        "const t = document.getElementById('p').firstChild, r = document.createRange();
        const at = (i) => { r.setStart(t, i); r.setEnd(t, i + 1); const b = r.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
        const [px, py, pw, ph] = at(3), [ax, ay] = at(4);
        // the first word of each line: lines 1 and 2 run beside the cap (34 px tall), line 3 not
        const firsts = {};
        for (const m of t.data.matchAll(/\\S+/g)) {
            const [x, y] = at(m.index);
            const line = Math.floor((y + 2) / 20);
            if (!(line in firsts)) firsts[line] = Math.round(x);
        }
        console.log(JSON.stringify(t.data.slice(0, 7)), document.getElementById('p').textContent.length === t.data.length);
        console.log(px, py < 5, ph > 30, ax >= px + pw, ay < 5);
        console.log(firsts[1] >= px + pw, firsts[2] < 5, JSON.stringify(firsts));",
    );
    assert_eq!(logs[0], "\"\\n\\t\\tPaul\" true");
    assert_eq!(logs[1], "0 true true true true");
    assert!(logs[2].starts_with("true true "), "{}", logs[2]);
}
