//! An inline SVG takes `fill` and `stroke` from the page's CSS as a browser does: a rule on one of
//! its elements beats that element's presentation attribute, and the `<svg>` inherits them from
//! the page unless it has an attribute of its own. readest-app colours icons with Tailwind's
//! `fill-*` classes (Book Details' red delete icon); Blitz hands usvg only the SVG's attributes, so
//! they were drawn in `currentColor`.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The colour cairo paints at the centre of `body`'s first 40x40 px, on white.
fn centre(body: &str) -> (u8, u8, u8) {
    let html = format!(
        "<!DOCTYPE html><html><head><style>.red {{ fill: rgb(255, 0, 0) }} \
         .blue {{ stroke: rgb(0, 0, 255) }}</style></head><body style='margin:0'>{body}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(40, 40, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 40, 40).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            None,
            &Rect::new(0.0, 0.0, 40.0, 40.0),
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 40, 40, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let p = &data[20 * stride + 20 * 4..];
    (p[2], p[1], p[0])
}

const SQUARE: &str = "<rect width='40' height='40'/>";

#[test]
fn a_rule_on_the_svg_beats_its_fill_attribute() {
    let svg = format!("<svg class='red' fill='currentColor' width='40' height='40'>{SQUARE}</svg>");
    assert_eq!(centre(&svg), (255, 0, 0));
}

#[test]
fn a_rule_on_a_shape_beats_the_fill_it_inherits() {
    let svg = "<svg fill='currentColor' width='40' height='40'><rect class='red' width='40' height='40'/></svg>";
    assert_eq!(centre(svg), (255, 0, 0));
}

#[test]
fn an_svg_inherits_fill_and_stroke_from_the_page() {
    let svg = format!("<div class='red'><svg width='40' height='40'>{SQUARE}</svg></div>");
    assert_eq!(centre(&svg), (255, 0, 0));
    let svg = "<div class='blue'><svg fill='none' width='40' height='40'>\
               <line x1='0' y1='20' x2='40' y2='20' stroke-width='40'/></svg></div>";
    assert_eq!(centre(svg), (0, 0, 255));
}

#[test]
fn an_svg_attribute_beats_the_fill_the_page_gives() {
    let svg = format!(
        "<div class='red'><svg fill='rgb(0, 128, 0)' width='40' height='40'>{SQUARE}</svg></div>"
    );
    assert_eq!(centre(&svg), (0, 128, 0));
}
