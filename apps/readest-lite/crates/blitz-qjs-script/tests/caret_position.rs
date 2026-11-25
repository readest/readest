//! `document.caretPositionFromPoint` / `caretRangeFromPoint`: the text node under a point and the
//! offset (UTF-16) of the caret nearest it. Readest selects the word under a double tap with them,
//! and its reading ruler, instant highlights and cross-page selections find text by them. Points
//! are taken from Range boxes, so no font metric is assumed; the text is bullets in Blitz's
//! built-in bullet font, 3 bytes each in UTF-8 and one UTF-16 unit.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

fn run(body: &str, script: &str) -> Vec<String> {
    let html = format!(
        "<!DOCTYPE html><html style='margin:0'><body style='margin:0; font: 16px/20px Bullet'>{body}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        &format!(
            "const $ = (id) => document.getElementById(id);
            const box = (n, s, e) => {{ const r = document.createRange(); r.setStart(n, s); r.setEnd(n, e); return r.getBoundingClientRect(); }};
            // the caret at the left and the right quarter of character `i` of text node `t`
            const at = (t, i, right) => {{
              const b = box(t, i, i + 1);
              const p = document.caretPositionFromPoint(b.x + b.width * (right ? 0.75 : 0.25), b.y + b.height / 2);
              return p ? `${{p.offsetNode === t}} ${{p.offset}}` : 'null';
            }};
            {script}"
        ),
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn a_point_on_a_character_is_a_caret_before_or_after_it() {
    let logs = run(
        "<p id='a' style='margin:0'>•• ◦◦ ▪▪</p>",
        "const t = $('a').firstChild;
        console.log(at(t, 0, false), at(t, 3, false), at(t, 3, true), at(t, 7, true));",
    );
    assert_eq!(logs, ["true 0 true 3 true 4 true 8"]);
}

#[test]
fn the_caret_is_in_the_text_node_under_the_point() {
    // three text nodes on one line: the inline element's and the ones around it
    let logs = run(
        "<p id='a' style='margin:0'>•• <b id='b'>◦◦</b> ▪▪</p>",
        "const [t0, t2] = [$('a').firstChild, $('a').lastChild];
        const t1 = $('b').firstChild;
        console.log(at(t0, 1, true), at(t1, 1, false), at(t2, 1, false), at(t2, 2, true));",
    );
    assert_eq!(logs, ["true 2 true 1 true 1 true 3"]);
}

#[test]
fn offsets_count_the_white_space_the_line_collapsed() {
    // the DOM keeps the run of spaces and the newline; the line holds one space
    let logs = run(
        "<p id='a' style='margin:0'>••   \n  ◦◦</p>",
        "const t = $('a').firstChild;
        console.log(at(t, 8, false), at(t, 9, true));",
    );
    assert_eq!(logs, ["true 8 true 10"]);
}

#[test]
fn a_caret_range_is_collapsed_at_the_caret_position() {
    let logs = run(
        "<p id='a' style='margin:0'>•• ◦◦ ▪▪</p>",
        "const t = $('a').firstChild;
        const b = box(t, 4, 5);
        const r = document.caretRangeFromPoint(b.x + b.width * 0.75, b.y + b.height / 2);
        console.log(r.startContainer === t, r.startOffset, r.collapsed);",
    );
    assert_eq!(logs, ["true 5 true"]);
}
