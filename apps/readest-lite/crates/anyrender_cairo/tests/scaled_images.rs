//! A large image drawn smaller (a cover, a full-page illustration) is shrunk once, not on every
//! frame: cairo's Good filter costs ~600 ms per shrink of a cover on a Kindle, and a page repaints
//! several times while a book opens.

use anyrender::PaintScene as _;
use anyrender_cairo::{Caches, CairoScene};
use peniko::{
    Blob, Extend, ImageAlphaType, ImageBrush, ImageData, ImageFormat,
    kurbo::{Affine, Rect},
};
use std::time::Instant;

/// The cover of the test EPUB on a Kindle Voyage page: 1227 px wide drawn 712 px wide.
const SCALE: f64 = 712.0 / 1227.0;

/// A 2400x2400 opaque RGBA image with detail at every pixel.
fn image() -> ImageData {
    let n = 2400u32;
    let mut px = Vec::with_capacity((n * n * 4) as usize);
    for y in 0..n {
        for x in 0..n {
            px.extend_from_slice(&[
                (x * 7 % 256) as u8,
                (y * 13 % 256) as u8,
                ((x ^ y) % 256) as u8,
                255,
            ]);
        }
    }
    ImageData {
        data: Blob::new(std::sync::Arc::new(px)),
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width: n,
        height: n,
    }
}

/// Draws `img` at SCALE at (10, 20) on a 1220x1220 frame; returns the frame's pixels.
fn frame(caches: &mut Caches, img: &ImageData) -> Vec<u8> {
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 1220, 1220).unwrap();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = CairoScene::new(cr, caches);
        scene.fill(
            peniko::Fill::NonZero,
            Affine::IDENTITY,
            peniko::Color::WHITE,
            None,
            &Rect::new(0.0, 0.0, 1220.0, 1220.0),
        );
        scene.draw_image(
            // As Blitz draws an <img>: repeat extend, in the image's own rect.
            ImageBrush::new(img.clone())
                .with_extend(Extend::Repeat)
                .as_ref(),
            Affine::translate((10.0, 20.0)) * Affine::scale(SCALE),
        );
    }
    surface.flush();
    surface.data().unwrap().to_vec()
}

#[test]
fn a_shrunk_image_draws_as_cairo_shrinks_it() {
    let img = image();
    let ours = frame(&mut Caches::new(), &img);
    // cairo's own shrink with the Good filter (image-rendering: auto), drawn at the same place.
    let mut src = cairo::ImageSurface::create(cairo::Format::ARgb32, 2400, 2400).unwrap();
    {
        let stride = src.stride() as usize;
        let mut d = src.data().unwrap();
        for (i, p) in img.data.data().chunks(4).enumerate() {
            let v = 255u32 << 24 | u32::from(p[0]) << 16 | u32::from(p[1]) << 8 | u32::from(p[2]);
            let (x, y) = (i % 2400, i / 2400);
            d[y * stride + x * 4..y * stride + x * 4 + 4].copy_from_slice(&v.to_ne_bytes());
        }
    }
    let mut want = cairo::ImageSurface::create(cairo::Format::Rgb24, 1220, 1220).unwrap();
    {
        let cr = cairo::Context::new(&want).unwrap();
        cr.set_source_rgb(1.0, 1.0, 1.0);
        cr.paint().unwrap();
        cr.translate(10.0, 20.0);
        cr.scale(SCALE, SCALE);
        let p = cairo::SurfacePattern::create(&src);
        p.set_filter(cairo::Filter::Good);
        p.set_extend(cairo::Extend::Repeat);
        cr.set_source(&p).unwrap();
        cr.rectangle(0.0, 0.0, 2400.0, 2400.0);
        cr.fill().unwrap();
    }
    want.flush();
    let want = want.data().unwrap();
    // Within rounding: pixman's fixed-point translation differs between the two.
    let worst = ours
        .iter()
        .zip(want.iter())
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .unwrap();
    assert!(
        worst <= 2,
        "differs from cairo's own shrink by up to {worst}"
    );
}

#[test]
fn a_shrunk_image_is_not_shrunk_again_on_the_next_frame() {
    let img = image();
    let mut caches = Caches::new();
    let t = Instant::now();
    let first = frame(&mut caches, &img);
    let first_ms = t.elapsed().as_secs_f64() * 1000.0;
    let mut next_ms = f64::MAX;
    for _ in 0..4 {
        let t = Instant::now();
        assert_eq!(frame(&mut caches, &img), first);
        next_ms = next_ms.min(t.elapsed().as_secs_f64() * 1000.0);
    }
    // The first frame decodes and shrinks; a later one only copies (a few percent of that).
    assert!(
        next_ms < first_ms / 5.0,
        "first frame {first_ms:.1} ms, fastest later frame {next_ms:.1} ms"
    );
}

#[test]
fn a_tiled_image_still_tiles() {
    // A background that repeats a shrunk image fills more than the image's own rect.
    let mut px = Vec::new();
    for y in 0..64u32 {
        for x in 0..64u32 {
            px.extend_from_slice(&[(x * 4) as u8, (y * 4) as u8, 0, 255]);
        }
    }
    let img = ImageData {
        data: Blob::new(std::sync::Arc::new(px)),
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width: 64,
        height: 64,
    };
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 100, 100).unwrap();
    let mut caches = Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = CairoScene::new(cr, &mut caches);
        let brush = ImageBrush::new(img).with_extend(Extend::Repeat);
        scene.fill(
            peniko::Fill::NonZero,
            Affine::scale(SCALE),
            brush.as_ref(),
            None,
            &Rect::new(0.0, 0.0, 160.0, 160.0),
        );
    }
    surface.flush();
    let data = surface.data().unwrap();
    // Pixel (50, 10) is in the second tile across: its red restarts low, as in the first tile.
    let red = |x: usize, y: usize| data[(y * 100 + x) * 4 + 2];
    assert!(
        red(50, 10) < red(30, 10),
        "second tile red {} first tile {}",
        red(50, 10),
        red(30, 10)
    );
}
