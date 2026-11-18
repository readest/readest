//! Content an element clips away (`overflow` other than `visible`) isn't hit where it is clipped,
//! as it isn't painted there. readest-app's menus scroll (`overflow-y: auto`): a tap just below
//! an open menu, where its hidden items lie, chose one of them instead of reaching the page.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

const PAGE: &str = "<!DOCTYPE html><html><body style='margin:0'>
    <div id='under' style='width:200px; height:400px'></div>
    <div id='menu' style='position:absolute; left:0; top:0; width:200px; height:100px; overflow-y:auto'>
      <div id='a' style='height:80px'></div>
      <div id='b' style='height:80px'>b</div>
      <div id='c' style='height:80px'></div>
    </div>
    <div id='hidden' style='position:absolute; left:0; top:200px; width:200px; height:50px; overflow:hidden'>
      <div id='tall' style='height:100px'></div>
    </div>
    <div id='visible' style='position:absolute; left:0; top:300px; width:200px; height:20px'>
      <div id='spill' style='height:60px'></div>
    </div>
    </body></html>";

#[test]
fn clipped_content_is_not_hit_where_it_is_clipped() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 400, 1.0, ColorScheme::Light)),
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
    // In the menu, its items; below it, where `b`'s text and `c` are clipped, the page.
    assert_eq!(hit_id(50.0, 90.0).as_deref(), Some("b"));
    assert_eq!(hit_id(5.0, 110.0).as_deref(), Some("under"));
    assert_eq!(hit_id(50.0, 170.0).as_deref(), Some("under"));
    assert_eq!(hit_id(50.0, 220.0).as_deref(), Some("tall"));
    assert_eq!(hit_id(50.0, 270.0).as_deref(), Some("under"));
    // `overflow: visible` doesn't clip.
    assert_eq!(hit_id(50.0, 340.0).as_deref(), Some("spill"));
}
