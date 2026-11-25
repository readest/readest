//! An empty input's placeholder takes its colour from the page's `::placeholder` rules, and is
//! drawn at half the input's text colour when no rule applies. readest-app's e-ink mode makes
//! placeholders solid ink (`[data-eink='true'] [class*='placeholder']::placeholder`); Blitz matched
//! no `::placeholder` rule, so the library's search box kept a half-tone placeholder on the Kindle.
//! A placeholder set again by script is drawn with its new text: the library's search box kept
//! its first one ("Search Books...") after readest-app set "Search in 3 books...".

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The darkest pixel (by its green channel) cairo paints for `body` on white (200x60), as RGB.
fn darkest(body: &str) -> (u8, u8, u8) {
    darkest_after(body, None)
}

/// As [`darkest`], painted once more after `script` runs, when there is one.
fn darkest_after(body: &str, script: Option<&str>) -> (u8, u8, u8) {
    paint(&mut doc_after(body, script))
}

/// The pixels cairo paints for `body` on white (200x60), after `script` runs when there is one.
fn pixels_after(body: &str, script: Option<&str>) -> Vec<u8> {
    render(&mut doc_after(body, script)).data().unwrap().to_vec()
}

/// `body` laid out at 200x60, painted and then changed by `script`, when there is one.
fn doc_after(body: &str, script: Option<&str>) -> QjsDocument {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 60, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    if let Some(script) = script {
        render(&mut doc);
        doc.eval(script, "test");
        doc.inner_mut().resolve(0.0);
    }
    doc
}

fn paint(doc: &mut QjsDocument) -> (u8, u8, u8) {
    let mut surface = render(doc);
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let mut best = (255, 255, 255);
    for y in 0..60 {
        for x in 0..200 {
            let p = &data[y * stride + x * 4..];
            if p[1] < best.1 {
                best = (p[2], p[1], p[0]);
            }
        }
    }
    best
}

fn render(doc: &mut QjsDocument) -> cairo::ImageSurface {
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 200, 60).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, 200.0, 60.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 60, 0, 0);
    }
    surface.flush();
    surface
}

const INPUT: &str = "<input placeholder='Search' class='search' \
    style='border: 0; padding: 0; margin: 0; font-size: 30px; color: black; width: 180px'>";

#[test]
fn a_placeholder_takes_the_colour_of_its_rule() {
    let body = format!("<style>.search::placeholder {{ color: rgb(0, 0, 255) }}</style>{INPUT}");
    assert_eq!(darkest(&body), (0, 0, 255));
}

#[test]
fn a_placeholder_rule_matches_through_its_input_s_ancestors() {
    let body = format!(
        "<style>[data-eink] [class*='search']::placeholder {{ color: black !important }}\
         .search::placeholder {{ color: rgba(0, 0, 0, 0.5) }}</style>\
         <div data-eink='true'>{INPUT}</div>"
    );
    assert_eq!(darkest(&body), (0, 0, 0));
}

#[test]
fn a_placeholder_without_a_rule_is_half_the_text_colour() {
    let (_, g, _) = darkest(INPUT);
    assert!((120..=135).contains(&g), "darkest placeholder pixel {g}");
}

#[test]
fn a_placeholder_follows_a_rule_that_starts_to_match() {
    // Only an ancestor's attribute changes: the input's own style stays the same.
    let body = format!(
        "<style>[data-eink] .search::placeholder {{ color: rgb(0, 0, 255) }}</style>\
         <div id='root'>{INPUT}</div>"
    );
    let script = "document.getElementById('root').setAttribute('data-eink', 'true')";
    assert_eq!(darkest_after(&body, Some(script)), (0, 0, 255));
}

#[test]
fn a_placeholder_set_again_is_drawn_with_its_new_text() {
    let before = INPUT.replace("'Search'", "'Ab'");
    let script = "document.querySelector('input').placeholder = 'Search'";
    assert!(
        pixels_after(&before, Some(script)) == pixels_after(INPUT, None),
        "the input still shows its first placeholder"
    );
}
