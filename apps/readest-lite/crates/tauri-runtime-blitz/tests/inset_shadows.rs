//! An inset box-shadow is the padding box less a hole: the padding box offset by the shadow's
//! offsets and shrunk by its spread (CSS Backgrounds 3). daisyUI draws its menus' expand chevrons
//! as a 6px box with `box-shadow: inset 2px 2px` rotated by -135deg or 45deg: Blitz moved the hole
//! along the screen's axes instead of the element's, so a rotated chevron lost one of its two
//! strokes; it also left the offsets unscaled at a device scale above 1, and a faint line along
//! the box's far edges where the hole crosses them.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// The (red, green, blue) of the pixel at (x, y) when cairo paints `body` on white at `scale`
/// (a 200x200 CSS px viewport).
fn pixel(body: &str, scale: f32, x: usize, y: usize) -> (u8, u8, u8) {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let size = (200.0 * scale) as u32;
    let config = DocumentConfig {
        viewport: Some(Viewport::new(size, size, scale, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, size as i32, size as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, size as f64, size as f64);
        scene.fill(Fill::NonZero, Default::default(), Color::WHITE, None, &all);
        paint_scene(
            &mut scene,
            &mut doc.inner_mut(),
            scale as f64,
            size,
            size,
            0,
            0,
        );
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let p = &surface.data().unwrap()[y * stride + x * 4..];
    (p[2], p[1], p[0])
}

const RED: (u8, u8, u8) = (255, 0, 0);
const WHITE: (u8, u8, u8) = (255, 255, 255);

#[test]
fn a_rotated_inset_shadow_turns_with_its_element() {
    // 40x40 at (50, 50), turned a quarter clockwise: the shadow along its own top edge is along
    // the screen's right edge, and the one along its own left edge along the screen's top.
    let body = "<div style='margin: 50px; width: 40px; height: 40px; transform: rotate(90deg); \
                box-shadow: inset 4px 4px red'></div>";
    assert_eq!(pixel(body, 1.0, 70, 52), RED, "the stroke along the top");
    assert_eq!(pixel(body, 1.0, 88, 70), RED, "the stroke along the right");
    assert_eq!(
        pixel(body, 1.0, 52, 70),
        WHITE,
        "the left (the screen's offset) stays clear"
    );
}

#[test]
fn an_inset_shadow_scales_with_the_page() {
    // At scale 2 a 4px shadow is 8 device px wide.
    let body = "<div style='width: 40px; height: 40px; box-shadow: inset 4px 0 red'></div>";
    assert_eq!(pixel(body, 2.0, 6, 40), RED, "6 device px in");
    assert_eq!(pixel(body, 2.0, 10, 40), WHITE, "10 device px in");
}

#[test]
fn an_inset_shadow_leaves_no_line_where_its_hole_crosses_the_edge() {
    // The box spans x 10.5..50.5 (moved by a transform: layout rounds to whole pixels): the hole
    // (moved 4px right) covers its right edge, whose pixel column 50 the box covers by half.
    // Nothing of the shadow is drawn there.
    let body = "<div style='margin-left: 10px; width: 40px; height: 40px; \
                transform: translateX(0.5px); box-shadow: inset 4px 0 red'></div>";
    assert_eq!(pixel(body, 1.0, 50, 20), WHITE);
    assert_eq!(pixel(body, 1.0, 12, 20), RED, "the stroke itself");
}
