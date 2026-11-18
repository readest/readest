//! A single-line text input lays its value out across its content box, on one line: `text-align`
//! places it in the box, and a value wider than the box doesn't wrap. readest-app's settings
//! steppers are right-aligned `<input type=text>`s; Blitz laid the value out at its own width
//! (no width for the editor), so it sat at the left of the box whatever `text-align` said.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The bounding box (x0, y0, x1, y1) of the pixels cairo paints red when it paints `body` on white
/// (200x100).
fn red_box(body: &str) -> Option<(usize, usize, usize, usize)> {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 200, 100).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, 200.0, 100.0);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 100, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    let mut b: Option<(usize, usize, usize, usize)> = None;
    for y in 0..100 {
        for x in 0..200 {
            let p = &data[y * stride + x * 4..];
            if p[2] > 200 && p[1] < 100 && p[0] < 100 {
                b = Some(b.map_or((x, y, x, y), |(x0, y0, x1, y1)| {
                    (x0.min(x), y0.min(y), x1.max(x), y1.max(y))
                }));
            }
        }
    }
    b
}

const INPUT: &str = "border: 0; padding: 0; margin: 0; font-size: 20px; color: red; height: 40px";

#[test]
fn a_right_aligned_input_shows_its_value_at_the_right() {
    let body = format!("<input value='16' style='{INPUT}; width: 120px; text-align: right'>");
    let (x0, _, x1, _) = red_box(&body).expect("the value is drawn");
    assert!(
        x1 > 110 && x0 > 80,
        "the value spans x {x0}..{x1} of 0..120"
    );
}

#[test]
fn a_value_wider_than_its_input_stays_on_one_line() {
    let short = red_box(&format!("<input value='ab' style='{INPUT}; width: 40px'>")).unwrap();
    let long = red_box(&format!(
        "<input value='ab cd ef gh ij' style='{INPUT}; width: 40px'>"
    ))
    .unwrap();
    // The same line, centred in the box alike (wrapped, the lines' block was centred instead).
    assert_eq!(
        (long.1, long.3),
        (short.1, short.3),
        "rows {long:?} vs {short:?}"
    );
}
