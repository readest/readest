//! A focus that shows (`:focus-visible`) draws Chromium's focus ring (`outline: auto`) unless the
//! page styles its own: 2 CSS px of rgb(16, 16, 16) centred on the border box's edge, its corners
//! rounded. readest-app leaves most buttons to it: after Escape closes the Import menu, Readest
//! rings the Import button. Blitz's user-agent sheet had no `:focus-visible` rule and it painted
//! no `auto` outline.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const W: u32 = 120;
const H: u32 = 80;

/// The gray levels cairo paints at scale 2 (device px) for a 24x24 button at CSS (20, 20),
/// focused by script with nothing pressed yet (Chromium shows such a focus).
fn focused_button(style: &str) -> Vec<Vec<u8>> {
    let html = format!(
        "<!DOCTYPE html><html><body style='margin:0'>\
         <button style='position:absolute; left:20px; top:20px; width:24px; height:24px; padding:0; \
         border:0; background:white; {style}'></button></body></html>"
    );
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 2.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval("document.querySelector('button').focus()", "test");
    doc.inner_mut().resolve(0.0);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, W as f64, H as f64);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(&mut scene, &mut doc.inner_mut(), 2.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    (0..H as usize)
        .map(|y| (0..W as usize).map(|x| data[y * stride + x * 4 + 1]).collect())
        .collect()
}

#[test]
fn a_focus_that_shows_draws_chromium_s_ring() {
    let px = focused_button("");
    // The button's left edge is at device x 40, its middle at y 64: Readest (Chromium 151) at
    // scale 2 paints 255 255 16 16 16 16 255 255 from x 36.
    assert_eq!(&px[64][36..44], &[255, 255, 16, 16, 16, 16, 255, 255]);
    assert_eq!(
        (36..44).map(|y| px[y][64]).collect::<Vec<_>>(),
        [255, 255, 16, 16, 16, 16, 255, 255]
    );
    // Rounded: the ring's outer corner stays white.
    assert_eq!(px[38][38], 255);
}

#[test]
fn a_page_s_own_outline_replaces_the_ring() {
    let px = focused_button("outline: none");
    assert_eq!(&px[64][36..44], &[255; 8]);
}
