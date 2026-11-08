//! Paint order through cairo (CSS 2.1 Appendix E), as foliate-js's paginator relies on it: its
//! section views are `position: relative` inside a static `overflow: hidden` container, after an
//! opaque positioned background.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

/// Grey level of the pixel at (x, y) CSS px of `body`, painted at 200x200 on white.
fn luma(body: &str, x: usize, y: usize) -> u8 {
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
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            Default::default(),
            &all,
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 200, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    surface.data().unwrap()[y * stride + x * 4 + 1]
}

/// A white positioned background, then a static clipping box (`clip`) holding a relative box
/// whose black child is 150px square.
fn page(clip: &str) -> String {
    format!(
        "<div style='position:relative; width:200px; height:200px'>\
           <div style='position:absolute; inset:0; background:white'></div>\
           <div style='{clip}'>\
             <div style='position:relative; width:150px; height:150px'>\
               <div style='width:150px; height:150px; background:black'></div>\
             </div>\
           </div>\
         </div>"
    )
}

#[test]
fn relative_box_in_a_clipping_box_paints_above_earlier_positioned_boxes() {
    for clip in [
        "overflow:hidden",
        "display:flex; overflow:hidden",
        "overflow:clip",
        "contain:paint",
    ] {
        assert_eq!(luma(&page(clip), 10, 10), 0, "{clip}");
    }
}

#[test]
fn a_lifted_relative_box_is_still_clipped_by_the_boxes_it_was_lifted_past() {
    let clip = "width:100px; height:80px; overflow:hidden";
    assert_eq!(luma(&page(clip), 90, 70), 0);
    assert_eq!(luma(&page(clip), 120, 70), 255, "right of the clip");
    assert_eq!(luma(&page(clip), 90, 100), 255, "below the clip");
    // One axis only: overflow-x: clip leaves overflow-y visible (hidden would make it auto).
    let x_only = "width:100px; height:80px; overflow-x:clip; overflow-y:visible";
    assert_eq!(luma(&page(x_only), 120, 70), 255, "right of the x clip");
    assert_eq!(luma(&page(x_only), 90, 100), 0, "below the x clip");
    // Nested clipping boxes intersect.
    let nested = "<div style='position:relative; width:200px; height:200px'>\
        <div style='position:absolute; inset:0; background:white'></div>\
        <div style='width:120px; height:200px; overflow:hidden'><div style='width:200px; height:60px; overflow:hidden'>\
          <div style='position:relative; width:150px; height:150px; background:black'></div>\
        </div></div></div>";
    assert_eq!(luma(nested, 100, 50), 0);
    assert_eq!(luma(nested, 130, 50), 255, "outside the outer clip");
    assert_eq!(luma(nested, 100, 70), 255, "outside the inner clip");
}

#[test]
fn a_lifted_relative_box_scrolls_with_its_scroll_container() {
    let body = "<div style='position:relative; width:200px; height:200px'>\
        <div style='position:absolute; inset:0; background:white'></div>\
        <div id='s' style='width:200px; height:100px; overflow:hidden'>\
          <div style='height:50px'></div>\
          <div style='position:relative; width:100px; height:30px; background:black'></div>\
          <div style='height:300px'></div>\
        </div></div>";
    assert_eq!(luma(body, 10, 60), 0);
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    {
        let mut d = doc.inner_mut();
        let s = d.get_element_by_id("s").unwrap();
        d.scroll_to(s, 0.0, 40.0, blitz_dom::ScrollBehavior::Instant);
        d.resolve(0.0);
    }
    let mut surface = cairo::ImageSurface::create(cairo::Format::Rgb24, 200, 200).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, 200.0, 200.0);
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            Default::default(),
            &all,
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 200, 200, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap();
    assert_eq!(data[20 * stride + 10 * 4 + 1], 0, "scrolled up by 40");
    assert_eq!(
        data[60 * stride + 10 * 4 + 1],
        255,
        "no longer at its unscrolled place"
    );
}
