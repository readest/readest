//! A checkbox or radio input with `appearance: none` is an ordinary box, as in Chromium: its CSS
//! size and display apply, its `::before` and `::after` render, and no native control is drawn.
//! daisyUI's toggle (Readest's settings switches) is such a checkbox: an inline grid whose
//! `::before` is the knob. Blitz drew a native checkbox there, a square the size of its height.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The (red, green, blue) of the pixel at (x, y) when cairo paints `body` on white (200x200).
fn pixel(body: &str, x: usize, y: usize) -> (u8, u8, u8) {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
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
    (p[2], p[1], p[0])
}

const WHITE: (u8, u8, u8) = (255, 255, 255);

#[test]
fn a_checkbox_without_appearance_is_a_box_with_its_pseudo_elements() {
    // A 40x20 green grid; its ::before (red) fills the first 10px column.
    let body = "<style>
        input { appearance: none; display: inline-grid; grid-template-columns: 10px 1fr;
                width: 40px; height: 20px; margin: 0; padding: 0; border: 0; background: lime;
                color: blue; vertical-align: top }
        input::before { content: ''; background: red; grid-row-start: 1; grid-column-start: 1 }
        </style><input type=checkbox checked>";
    assert_eq!(pixel(body, 5, 10), (255, 0, 0), "the ::before");
    assert_eq!(pixel(body, 35, 10), (0, 255, 0), "the box, 40px wide");
    assert_eq!(pixel(body, 20, 10), (0, 255, 0), "no native check mark");
}

#[test]
fn a_checkbox_keeps_its_native_look_by_default() {
    let body = "<input type=checkbox checked style='width: 20px; height: 20px; margin: 0'>";
    assert_ne!(pixel(body, 10, 10), WHITE, "the checked box is filled");
}
