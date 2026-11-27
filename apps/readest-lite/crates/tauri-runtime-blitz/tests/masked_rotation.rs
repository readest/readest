//! A masked element shows only what its mask lets through, also when it is rotated: no trace of
//! its box. Blitz applied the mask in a layer clipped to the element's box, so where a rotated
//! box's edge crosses a pixel the mask erased the pixel only in part: Readest's e-ink spinner, a
//! masked square turned 45° at a time, drew a faint diamond around itself at every other step.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The grey of each pixel (blue channel) cairo paints for `body` at 100x100, on white.
fn pixels(body: &str) -> Vec<Vec<u8>> {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(100, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 100, 100).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            None,
            &Rect::new(0.0, 0.0, 100.0, 100.0),
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 100, 100, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    (0..100)
        .map(|y| (0..100).map(|x| data[y * stride + x * 4]).collect())
        .collect()
}

#[test]
fn a_rotated_masked_element_leaves_no_trace_of_its_box() {
    // A black 50x50 box centred at (50,50), turned 45°, masked to a disk of radius 10.
    let rows = pixels(
        "<div style='margin: 25px; width: 50px; height: 50px; background: black; \
           transform: rotate(45deg); \
           mask-image: radial-gradient(circle, black 10px, transparent 10.5px)'></div>",
    );
    assert!(rows[50][50] < 10, "the disk shows");
    let traces: Vec<(usize, usize, u8)> = (0..100)
        .flat_map(|y| (0..100).map(move |x| (x, y)))
        .filter(|&(x, y)| (x as f64 - 49.5).hypot(y as f64 - 49.5) > 13.0)
        .map(|(x, y)| (x, y, rows[y][x]))
        .filter(|&(_, _, g)| g != 255)
        .collect();
    assert_eq!(traces, [], "pixels outside the disk that aren't white");
}
