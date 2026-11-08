//! `scrollTo({ behavior: 'smooth' })` animates as Chromium's programmatic smooth scrolls do: over
//! 6 to 12 frames by distance, a `scroll` event per frame, replaced by a later scroll of the
//! element. react-virtuoso's smooth `scrollToIndex` re-aims when the list changes mid-scroll; an
//! instant jump left Readest's TOC short of the chapter it centres.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

fn run(script: &str) -> Vec<String> {
    let html = "<!DOCTYPE html><html style='margin:0'><body style='margin:0'>\
        <div id='s' style='height:100px;overflow:auto'><div style='height:2000px'></div></div></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        &format!(
            "const s = document.getElementById('s');
            let events = 0;
            s.addEventListener('scroll', () => events++);
            // frames 16 ms apart on the document clock, from t ms
            const frames = (t, count) => {{
                const tops = [];
                for (let i = 0; i < count; i++) {{ window.__blitzTimers(t + 16 * i); tops.push(s.scrollTop); }}
                return tops;
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
fn a_smooth_scroll_moves_over_frames() {
    let logs = run(
        "s.scrollTo({ top: 60, behavior: 'smooth' });
        console.log(s.scrollTop);
        const tops = frames(1000, 10);
        const between = tops.filter((t) => t > 0 && t < 60).length;
        console.log(between >= 3, tops.indexOf(60) <= 7, tops.at(-1), events >= 3);",
    );
    assert_eq!(logs, ["0", "true true 60 true"]);
}

#[test]
fn a_long_smooth_scroll_takes_longer_and_stops_at_the_end() {
    let logs = run(
        "s.scrollBy({ top: 5000, behavior: 'smooth' });
        const tops = frames(1000, 16);
        // 1900 px: the longest, 12 frames (the first one starts the clock)
        console.log(tops.indexOf(1900) >= 11, tops.indexOf(1900) <= 13, tops.at(-1));",
    );
    assert_eq!(logs, ["true true 1900"]);
}

#[test]
fn a_later_scroll_replaces_a_smooth_one() {
    let logs = run(
        "s.scrollTo({ top: 400, behavior: 'smooth' });
        frames(1000, 3);
        s.scrollTop = 10;
        console.log(frames(1048, 10).every((t) => t === 10));
        s.scrollTo({ top: 300, behavior: 'smooth' });
        frames(1300, 2);
        s.scrollTo({ top: 100, behavior: 'smooth' });
        console.log(frames(1400, 14).at(-1));",
    );
    assert_eq!(logs, ["true", "100"]);
}
