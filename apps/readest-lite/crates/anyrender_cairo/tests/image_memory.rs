//! An image's cairo surfaces live only as long as the image: a page's images go with their
//! document, and a large image drawn smaller keeps only its shrunk copy. On a Kindle a 1413x2475
//! title page is 14 MB as a surface, next to its document's 14 MB of decoded pixels.

use anyrender::PaintScene as _;
use anyrender_cairo::{Caches, CairoScene};
use peniko::{
    Blob, Extend, ImageAlphaType, ImageBrush, ImageData, ImageFormat,
    kurbo::{Affine, Rect},
};

/// The cover of the test EPUB on a Kindle Voyage page: 1227 px wide drawn 712 px wide.
const SCALE: f64 = 712.0 / 1227.0;
const N: u32 = 2400;

/// An NxN opaque RGBA image with detail at every pixel.
fn image() -> ImageData {
    let mut px = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
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
        width: N,
        height: N,
    }
}

/// A 1220x1220 frame with `img` (if any) drawn at SCALE at `at`, as Blitz draws an <img>.
fn frame(caches: &mut Caches, img: Option<&ImageData>, at: (f64, f64)) -> Vec<u8> {
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
        if let Some(img) = img {
            scene.draw_image(
                ImageBrush::new(img.clone())
                    .with_extend(Extend::Repeat)
                    .as_ref(),
                Affine::translate(at) * Affine::scale(SCALE),
            );
        }
    }
    surface.flush();
    surface.data().unwrap().to_vec()
}

#[test]
fn an_images_surfaces_go_with_the_image() {
    let mut caches = Caches::new();
    let img = image();
    frame(&mut caches, Some(&img), (10.0, 20.0));
    assert!(caches.image_kb().0 > 0);
    // Its document went: the next frame holds nothing for it.
    drop(img);
    frame(&mut caches, None, (0.0, 0.0));
    assert_eq!(
        caches.image_kb().0,
        0,
        "KB of surfaces still held for an image that is gone"
    );
}

#[test]
fn a_shrunk_image_keeps_only_its_shrunk_copy() {
    let mut caches = Caches::new();
    let img = image();
    frame(&mut caches, Some(&img), (10.0, 20.0));
    let shrunk_kb = (N as f64 * SCALE).ceil().powi(2) as usize * 4 / 1024;
    let held = caches.image_kb().0;
    assert!(
        held <= shrunk_kb + 64,
        "{held} KB held for a {shrunk_kb} KB shrunk copy of a {} KB image",
        N * N * 4 / 1024
    );
}

#[test]
fn a_shrunk_image_moved_draws_as_a_fresh_one() {
    // The first copy was made at (10, 20); a fraction of a pixel away it is made again, from
    // the image's pixels.
    let mut caches = Caches::new();
    let img = image();
    frame(&mut caches, Some(&img), (10.0, 20.0));
    let moved = frame(&mut caches, Some(&img), (10.5, 20.25));
    assert!(moved == frame(&mut Caches::new(), Some(&img), (10.5, 20.25)));
}
