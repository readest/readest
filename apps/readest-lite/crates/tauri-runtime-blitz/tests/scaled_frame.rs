//! An iframe scaled with `transform: scale()` draws its document at that scale. foliate-js sizes
//! a fixed-layout page (a comic's, a pre-paginated EPUB's) by scaling its iframe to the window:
//! Blitz kept only the transform's translation and drew every such page at its natural size, in
//! the top-left corner of the space it was given.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const W: u32 = 200;
const H: u32 = 100;

#[test]
fn a_scaled_iframe_draws_its_document_scaled() {
    // A 50x40 frame at x 10, scaled 2x from its top left: its document's black left half
    // (25x40) covers 10-60 x 0-80 of the page.
    let html = "<!DOCTYPE html><html><body style='margin: 0; padding-left: 10px'>\
        <iframe style='display: block; border: 0; width: 50px; height: 40px; \
          transform: scale(2); transform-origin: top left' \
          srcdoc=\"<body style='margin: 0'><div style='width: 25px; height: 40px; background: black'></div></body>\">\
        </iframe></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, f64::from(W), f64::from(H));
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap().to_vec();
    let luma = |x: usize, y: usize| data[y * stride + x * 4 + 1];
    assert_eq!(
        [(5, 10), (12, 2), (55, 40), (58, 75), (65, 40), (30, 85)].map(|(x, y)| luma(x, y)),
        [255, 0, 0, 0, 255, 255]
    );
}
