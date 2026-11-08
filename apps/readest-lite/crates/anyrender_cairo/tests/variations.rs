//! Variable fonts are drawn at the run's coordinates. Readest's UI font is Inter's variable
//! font: one file for every weight, the weight set by its `wght` axis. The fixture is Inter's "M"
//! (axes opsz 14-32 and wght 100-900, default 400, with an avar table).

use anyrender::{Glyph, PaintScene as _};
use anyrender_cairo::{Caches, CairoScene};
use peniko::{Blob, Color, Fill, FontData, kurbo::{Affine, Rect}};

/// The ink (summed darkness) of an "M" drawn with these normalized coordinates (opsz, wght).
fn ink(coords: &[i16]) -> u64 {
    let font = FontData::new(Blob::new(std::sync::Arc::new(include_bytes!("fixtures/inter-var-m.ttf").to_vec())), 0);
    let (w, h) = (60, 60);
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, w, h).unwrap();
    let mut caches = Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, f64::from(w), f64::from(h));
        scene.fill(Fill::NonZero, Affine::IDENTITY, Color::WHITE, None, &all);
        scene.draw_glyphs(
            &font,
            40.0,
            false,
            coords,
            Default::default(),
            Fill::NonZero,
            Color::BLACK,
            1.0,
            Affine::IDENTITY,
            None,
            [Glyph { id: 1, x: 5.0, y: 45.0 }].into_iter(),
        );
    }
    surface.flush();
    let data = surface.data().unwrap();
    data.chunks(4).map(|px| u64::from(255 - px[1])).sum()
}

#[test]
fn a_heavier_weight_draws_more_ink() {
    let regular = ink(&[]);
    assert_eq!(regular, ink(&[0, 0]), "default coordinates draw the default instance");
    let black = ink(&[0, 16384]); // wght at its maximum, 900
    assert!(black as f64 > regular as f64 * 1.4, "wght 900 drew {black}, wght 400 {regular}");
}
