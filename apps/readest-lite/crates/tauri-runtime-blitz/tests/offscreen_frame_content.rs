//! An iframe's content outside what clips the iframe is not drawn. foliate-js makes a section's
//! iframe as wide as all its pages and shows one page through a clipping container: Blitz drew
//! every page of the section on every frame and let the clip discard them (~40 ms of a Kindle's
//! frame in a long chapter, before rasterizing).

use anyrender::Scene;
use anyrender::recording::RenderCommand;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::shell::{ColorScheme, Viewport};

/// The colors of the solid fills painting `body` at 300x100 draws.
fn fill_colors(body: &str) -> Vec<[f32; 4]> {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    let mut scene = Scene::new();
    paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 300, 100, 0, 0);
    scene
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::Fill(f) => match &f.brush {
                anyrender::Paint::Solid(c) => Some(c.components),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];

/// A 100px box clipping a 400px iframe scrolled `scroll` px: a red box at 0-100 of the iframe
/// and a blue one at 200-300.
fn page(scroll: u32) -> String {
    format!(
        "<div id='c' style='width: 100px; height: 100px; overflow: hidden'>\
           <iframe style='border: 0; width: 400px; height: 100px; margin-left: -{scroll}px' \
             srcdoc=\"<body style='margin: 0'><div style='display: flex'>\
               <div style='flex: none; width: 100px; height: 100px; background: red'></div>\
               <div style='flex: none; width: 100px; height: 100px'></div>\
               <div style='flex: none; width: 100px; height: 100px; background: blue'></div>\
             </div></body>\"></iframe>\
         </div>"
    )
}

#[test]
fn iframe_content_clipped_out_of_view_is_not_drawn() {
    let fills = fill_colors(&page(0));
    assert!(fills.contains(&RED), "{fills:?}");
    assert!(!fills.contains(&BLUE), "{fills:?}");
    // scrolled to the blue box, the red one is out of view
    let fills = fill_colors(&page(200));
    assert!(fills.contains(&BLUE) && !fills.contains(&RED), "{fills:?}");
}
