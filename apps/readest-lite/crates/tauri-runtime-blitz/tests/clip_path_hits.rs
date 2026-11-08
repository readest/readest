//! `clip-path` clips hit testing as it clips paint. Readest's reader lays overlays over the whole
//! page and clips them down with `inset()`: the top-inset strip (SectionInfo's notch area) and
//! the page-turn overlay; taps outside the clip go to the book underneath.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const PAGE: &str = "<!DOCTYPE html><html><body style='margin:0'>
    <div id='under' style='width:200px; height:300px'></div>
    <div id='strip' style='position:absolute; inset:0; width:200px; height:200px; clip-path: inset(0 0 calc(100% - 20px) 0)'>
      <div id='kid' style='height:200px'></div>
    </div>
    <div id='tri' style='position:absolute; left:0; top:200px; width:100px; height:100px; clip-path: polygon(0 0, 100% 0, 0 100%)'></div>
    <div id='none' style='position:absolute; left:100px; top:200px; width:100px; height:100px; clip-path: inset(50%)'></div>
    </body></html>";

#[test]
fn a_point_outside_the_clip_path_hits_what_is_under_it() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 300, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(PAGE, config);
    doc.inner_mut().resolve(0.0);
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
    // inside the 20px strip, its child; below it, the page under the overlay
    assert_eq!(hit_id(50.0, 10.0).as_deref(), Some("kid"));
    assert_eq!(hit_id(50.0, 100.0).as_deref(), Some("under"));
    // the triangle's upper-left half
    assert_eq!(hit_id(10.0, 210.0).as_deref(), Some("tri"));
    assert_eq!(hit_id(90.0, 290.0).as_deref(), Some("under"));
    // an empty inset clips everything away
    assert_eq!(hit_id(150.0, 250.0).as_deref(), Some("under"));
}
