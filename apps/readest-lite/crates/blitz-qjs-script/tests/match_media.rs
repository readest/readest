//! `matchMedia` answers as the page's `@media` rules are evaluated (CSSOM View): by the style
//! engine, against the viewport. It always said `false`, so readest-app's `useResponsiveSize`
//! (react-responsive's width queries) sized its icons for a desktop on a Kindle's 536px-wide page,
//! 0.8 times their size in a browser.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

/// What `script` logs on a 1072x1448 page at scale 2 (536x724 CSS px, the Kindle Voyage).
fn run(script: &str) -> Vec<String> {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(1072, 1448, 2.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html("<!DOCTYPE html><html><body></body></html>", config);
    doc.inner_mut().resolve(0.0);
    doc.eval(script, "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn match_media_evaluates_the_query_against_the_viewport() {
    let logs = run("for (const q of [
            '(min-width: 481px) and (max-width: 1024px)',
            '(max-width: 480px)',
            '(orientation: portrait)',
            '(min-resolution: 2dppx)',
            'print',
            '(prefers-color-scheme: dark)',
            'not a valid query (',
        ]) console.log(q, matchMedia(q).matches, matchMedia(q).media);");
    assert_eq!(
        logs,
        [
            "(min-width: 481px) and (max-width: 1024px) true (min-width: 481px) and (max-width: 1024px)",
            "(max-width: 480px) false (max-width: 480px)",
            "(orientation: portrait) true (orientation: portrait)",
            "(min-resolution: 2dppx) true (min-resolution: 2dppx)",
            "print false print",
            "(prefers-color-scheme: dark) false (prefers-color-scheme: dark)",
            "not a valid query ( false not a valid query (",
        ]
    );
}
