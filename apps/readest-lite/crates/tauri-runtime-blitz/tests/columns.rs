//! The root element's columns, styled as foliate-js's paginator styles a section: one column of
//! the root's content width per page, `column-fill: auto`, a definite height, the columns
//! overflowing to the right.

use anyrender::PaintScene as _;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::{Color, Fill, kurbo::Rect};

const W: u32 = 640;
const H: u32 = 80;

/// Ten 20px lines `l0`..`l9` (each a 50px black box with a line of text height) in a root of
/// content box 100x50 with 10px side padding and a 20px gap: a page is 120px wide and holds two
/// lines (a third would be cut), so there are five columns.
fn section() -> String {
    let lines: String = (0..10)
        .map(|i| format!("<div id='l{i}' style='height:20px; line-height:20px'><span style='display:inline-block; width:50px; height:20px; background:black'></span></div>"))
        .collect();
    format!(
        "<!DOCTYPE html><html style='margin:0; width:100px; height:50px; padding:0 10px; \
         column-width:100px; column-gap:20px; column-fill:auto; overflow:hidden'>\
         <body style='margin:0'>{lines}</body></html>"
    )
}

fn doc() -> QjsDocument {
    load(&section())
}

fn load(html: &str) -> QjsDocument {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(W, H, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc
}

/// Grey levels of the painted page.
fn paint(doc: &mut QjsDocument) -> impl Fn(usize, usize) -> u8 + use<> {
    let mut surface =
        cairo::ImageSurface::create(cairo::Format::Rgb24, W as i32, H as i32).unwrap();
    let mut caches = anyrender_cairo::Caches::new();
    {
        let cr = cairo::Context::new(&surface).unwrap();
        let mut scene = anyrender_cairo::CairoScene::new(cr, &mut caches);
        let all = Rect::new(0.0, 0.0, f64::from(W), f64::from(H));
        scene.fill(
            Fill::NonZero,
            Default::default(),
            Color::WHITE,
            Default::default(),
            &all,
        );
        paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, W, H, 0, 0);
    }
    surface.flush();
    let stride = surface.stride() as usize;
    let data = surface.data().unwrap().to_vec();
    move |x, y| data[y * stride + x * 4 + 1]
}

fn logs(doc: &mut QjsDocument, script: &str) -> Vec<String> {
    doc.eval(script, "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
}

#[test]
fn element_rects_are_in_their_column() {
    let mut doc = doc();
    let logs = logs(
        &mut doc,
        "const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].join(','); };
        console.log(r('l0'), '|', r('l1'), '|', r('l2'), '|', r('l5'), '|', r('l9'));
        console.log(r('l2').split(',')[1] === '0', document.body.getBoundingClientRect().width, document.documentElement.getBoundingClientRect().width);",
    );
    assert_eq!(
        logs,
        [
            "log: 10,0,100,20 | 10,20,100,20 | 130,0,100,20 | 250,20,100,20 | 490,20,100,20",
            // the body spans all five columns; the root keeps its own box
            "log: true 580 120",
        ]
    );
}

#[test]
fn the_root_scrolls_sideways_only() {
    let mut doc = doc();
    let logs = logs(
        &mut doc,
        "const e = document.documentElement; console.log(e.scrollWidth, e.scrollHeight, e.clientWidth, e.clientHeight);",
    );
    // the root's client size is the viewport's (CSSOM View), not its box: Readest scales a
    // frame point to the window by the iframe's width over it
    assert_eq!(logs, ["log: 600 50 640 80"]);
}

#[test]
fn a_point_hits_the_line_painted_there() {
    let doc = doc();
    let d = doc.inner();
    let hit_id = |x: f32, y: f32| {
        let mut id = d.hit(x, y)?.node_id;
        loop {
            let node = d.get_node(id)?;
            if let Some(v) = node
                .element_data()
                .and_then(|e| e.attr(blitz_dom::local_name!("id")))
            {
                return Some(v.to_string());
            }
            id = node.parent?;
        }
    };
    assert_eq!(hit_id(20.0, 5.0).as_deref(), Some("l0"));
    assert_eq!(hit_id(140.0, 25.0).as_deref(), Some("l3"));
    assert_eq!(hit_id(500.0, 25.0).as_deref(), Some("l9"));
}

#[test]
fn each_column_paints_its_slice() {
    let luma = paint(&mut doc());
    // two lines in every column, black where the boxes are
    for col in 0..5 {
        let x = 10 + col * 120 + 25;
        assert_eq!((luma(x, 10), luma(x, 30)), (0, 0), "column {col}");
        // nothing below the second line (the third line is not cut in half there)
        assert_eq!(luma(x, 45), 255, "column {col} bottom");
        // right of the boxes, inside the column
        assert_eq!(luma(x + 50, 10), 255, "column {col} right");
    }
    assert_eq!(luma(10 + 5 * 120 + 25, 10), 255, "no sixth column");
}

#[test]
fn columns_paint_in_a_scrolled_iframe() {
    // foliate-js's paginator: the section's iframe in a relative view inside a static
    // `overflow: hidden` container that it scrolls by a page per turn.
    let page = format!(
        "<!DOCTYPE html><html><body style='margin:0'>\
         <div id='c' style='width:240px; height:50px; overflow:hidden'>\
           <div style='position:relative; width:600px; height:50px'>\
             <iframe style='border:0; width:600px; height:50px' srcdoc=\"{}\"></iframe>\
           </div>\
         </div></body></html>",
        section().replace('"', "&quot;")
    );
    let mut doc = load(&page);
    {
        let mut d = doc.inner_mut();
        let c = d.get_element_by_id("c").unwrap();
        d.scroll_to(c, 240.0, 0.0, blitz_dom::ScrollBehavior::Instant);
        d.resolve(0.0);
    }
    let luma = paint(&mut doc);
    // columns 2 and 3 are on screen, each with its two lines
    for x in [10 + 25, 130 + 25] {
        assert_eq!((luma(x, 10), luma(x, 30)), (0, 0), "x {x}");
    }
    assert_eq!(luma(250, 10), 255, "nothing right of the container");
}
