//! Layout is rounded to device pixels, not to CSS pixels: at a device scale of 2 (the Kindle's)
//! a box can start or end on a half CSS pixel, as in Chromium at that scale. Readest's
//! library search box is split by a 0.5px rule (`w-[0.5px]`) that sits at x 275.5: rounded to
//! whole CSS pixels both its edges came to 276, and it was not drawn.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The red channel of row `y`'s pixels `xs` when cairo paints `body` on white at `scale` (a
/// 100x50 CSS px viewport).
fn row(body: &str, scale: f32, y: usize, xs: std::ops::Range<usize>) -> Vec<u8> {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let (w, h) = ((100.0 * scale) as u32, (50.0 * scale) as u32);
    let config = DocumentConfig {
        viewport: Some(Viewport::new(w, h, scale, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, w as i32, h as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, w as f64, h as f64);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), scale as f64, w, h, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    xs.map(|x| data[y * stride + x * 4 + 2]).collect()
}

/// A flex row whose one item, `width` wide, starts at x 10.5.
fn at_half_pixel(width: &str) -> String {
    format!(
        "<div style='display: flex; padding-left: 10.5px'>\
         <span style='width: {width}; height: 16px; background: black'></span></div>"
    )
}

#[test]
fn a_half_pixel_rule_is_one_device_pixel_at_scale_2() {
    assert_eq!(
        row(&at_half_pixel("0.5px"), 2.0, 10, 19..24),
        [255, 255, 0, 255, 255]
    );
}

#[test]
fn a_box_starts_on_the_half_pixel_at_scale_2() {
    // 10.5..30.5 CSS px is 21..61 device px.
    assert_eq!(
        row(&at_half_pixel("20px"), 2.0, 10, 19..23),
        [255, 255, 0, 0]
    );
    assert_eq!(
        row(&at_half_pixel("20px"), 2.0, 10, 59..63),
        [0, 0, 255, 255]
    );
}

#[test]
fn layout_keeps_whole_pixels_at_scale_1() {
    // 10.5 rounds to 11, as before.
    assert_eq!(
        row(&at_half_pixel("20px"), 1.0, 10, 9..13),
        [255, 255, 0, 0]
    );
}
