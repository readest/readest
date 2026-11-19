//! `opacity` on an inline element fades its text and its text decorations, multiplied through
//! nested inline elements, as in Chromium. Blitz applied `opacity` only to boxes it paints as
//! layers, so text inside an inline `<span>` kept full ink: Readest's Speed Reading context
//! panel dims every word but the current one (`opacity-70`), and on Lite all of them were black.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The darkest grey cairo paints for `body` in black 40px text on white (200x60).
fn darkest(body: &str) -> u8 {
    let html = format!(
        "<!DOCTYPE html><html><body style='margin:0; font-size:40px; line-height:60px; color:black'>{body}</body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 60, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
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
    let data = surface.data().unwrap();
    data.chunks(4).map(|p| p[1]).min().unwrap()
}

#[test]
fn opacity_on_an_inline_element_fades_its_text() {
    let got = [
        darkest("<span>HHH</span>"),
        darkest("<span style='opacity:0.5'>HHH</span>"),
        darkest("<span style='opacity:0.5'><b style='opacity:0.5'>HHH</b></span>"),
        darkest("<div style='opacity:0.5'>HHH</div>"),
        // only the underline has ink: a decorating box fades its decoration
        darkest(
            "<span style='opacity:0.5; color:transparent; text-decoration:underline 4px black'>HHH</span>",
        ),
    ];
    // full ink, half, a quarter (0.5 x 0.5), the block layer (unchanged), the underline at half
    let want = [0, 128, 191, 128, 128];
    assert!(
        got.iter().zip(want).all(|(g, w)| g.abs_diff(w) <= 2),
        "darkest {got:?}, want {want:?}"
    );
}
