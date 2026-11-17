//! Content that can't show draws nothing. While a book opens, Readest shows a spinner with a
//! screen-reader-only "Loading..." beside it. The spinner is masked by an image Lite has no pixels
//! for, and the text is clipped away by `clip-path: inset(50%)`. Both still drew, so frames looked
//! changed and were rasterized and presented to an e-ink screen with no pixel changed.

use anyrender::Scene;
use anyrender::recording::RenderCommand;
use blitz_dom::{Document as _, DocumentConfig};
use blitz_paint::paint_scene;
use blitz_qjs_script::QjsDocument;
use blitz_traits::net::{Bytes, NetHandler, NetProvider, Request};
use blitz_traits::shell::{ColorScheme, Viewport};
use std::sync::Arc;

/// Serves every URL with bytes that are no image.
struct NoImages;
impl NetProvider for NoImages {
    fn fetch(&self, _doc_id: usize, request: Request, handler: Box<dyn NetHandler>) {
        handler.bytes(request.url.to_string(), Bytes::from_static(b"not an image"));
    }
}

/// The drawing commands of `body` at 300x100, once what it loads has arrived.
fn paint(body: &str) -> Vec<RenderCommand> {
    let html = format!("<!DOCTYPE html><html><body style='margin:0'>{body}</body></html>");
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 100, 1.0, ColorScheme::Light)),
        net_provider: Some(Arc::new(NoImages)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.inner_mut().resolve(0.0);
    let mut scene = Scene::new();
    paint_scene(&mut scene, &mut doc.inner_mut(), 1.0, 300, 100, 0, 0);
    scene.commands
}

/// Whether the commands draw anything red or any text.
fn draws(commands: &[RenderCommand]) -> bool {
    commands.iter().any(|c| match c {
        RenderCommand::Fill(f) => {
            matches!(&f.brush, anyrender::Paint::Solid(c) if c.components == [1.0, 0.0, 0.0, 1.0])
        }
        RenderCommand::GlyphRun(_) => true,
        _ => false,
    })
}

// Tailwind's `sr-only`.
const SR_ONLY: &str = "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; \
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; border-width: 0";

#[test]
fn an_element_clipped_to_an_empty_region_draws_nothing() {
    let shown = paint("<div style='width: 50px; height: 20px; background: red'>Loading...</div>");
    assert!(draws(&shown));
    let clipped = paint(&format!(
        "<div style='{SR_ONLY}; background: red'>Loading...</div>"
    ));
    assert!(!draws(&clipped), "{clipped:?}");
    let half = paint(
        "<div style='width: 50px; height: 20px; background: red; clip-path: inset(40%)'>x</div>",
    );
    assert!(draws(&half));
}

// Lite gets no image from the SVG that masks daisyUI's e-ink spinner.
#[test]
fn an_element_masked_by_an_image_that_did_not_decode_draws_nothing() {
    let masked = paint(
        "<div style='width: 40px; height: 40px; background: red; \
           mask-image: url(http://localhost/spinner.svg)'>Loading...</div>",
    );
    assert!(!draws(&masked), "{masked:?}");
    let gradient = paint(
        "<div style='width: 40px; height: 40px; background: red; \
           mask-image: linear-gradient(black, transparent)'></div>",
    );
    assert!(draws(&gradient));
}
