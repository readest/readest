//! A border edge of width 0 draws nothing (CSS Backgrounds 3: the border area is empty).
//! Tailwind's preflight gives every element `border: 0 solid`, and Readest rounds the corners of
//! `html` and `body`: Blitz still drew each element's four empty edges, and at a rounded corner
//! split by two zero widths its arc came out NaN, so no two frames compared equal.

use anyrender::recording::RenderCommand;
use anyrender::{PaintScene as _, Scene};
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

fn load(body: &str) -> QjsDocument {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc
}

/// The fills `body` paints at 200x200 (the root's background first): their colors and whether
/// any coordinate is NaN.
fn fills(body: &str) -> Vec<(Vec<f32>, bool)> {
    let mut doc = load(body);
    let mut scene = Scene::new();
    paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 200, 0, 0);
    scene
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::Fill(f) => Some(f),
            _ => None,
        })
        .map(|f| {
            let color = match &f.brush {
                anyrender::Paint::Solid(c) => c.components.to_vec(),
                _ => Vec::new(),
            };
            let nan = f
                .shape
                .elements()
                .iter()
                .any(|e| format!("{e:?}").contains("NaN"));
            (color, nan)
        })
        .collect()
}

/// The (red, green) of the pixel at (x, y) when cairo paints `body` on white.
fn pixel(body: &str, x: usize, y: usize) -> (u8, u8) {
    let mut doc = load(body);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 200, 200).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, 200.0, 200.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 200, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let p = &surface.data().unwrap()[y * stride + x * 4..];
    (p[2], p[1])
}

const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

#[test]
fn a_zero_width_border_draws_nothing() {
    for radius in ["0", "10px"] {
        let body = format!(
            "<div style='width: 50px; height: 50px; border: 0 solid red; border-radius: {radius}'></div>"
        );
        let fills = fills(&body);
        assert!(
            fills.iter().all(|(color, nan)| color != &RED && !nan),
            "border-radius: {radius}: {fills:?}"
        );
    }
    // one zero-width edge among drawn ones: the others are drawn, that one isn't
    let body = "<div style='width: 50px; height: 50px; border: 2px solid red; \
        border-top-width: 0; border-radius: 10px'></div>";
    let fills = fills(body);
    assert!(fills.iter().all(|(_, nan)| !nan), "{fills:?}");
    assert_eq!(pixel(body, 1, 25), (255, 0), "left edge");
    assert_eq!(pixel(body, 27, 1), (255, 255), "top edge");
}
