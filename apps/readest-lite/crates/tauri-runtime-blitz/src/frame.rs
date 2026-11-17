//! Whether a frame would change a pixel of the last one shown.

use anyrender::{Paint, Scene, recording::RenderCommand};
use peniko::{BlendMode, Color};

/// Whether frames recorded as `a` and `b`, each drawn on a white page, have the same pixels: the
/// same commands, once those that change no pixel are left out.
pub(crate) fn same_pixels(a: &Scene, b: &Scene) -> bool {
    match (visible(a), visible(b)) {
        (Some(a), Some(b)) => a == b,
        _ => a == b,
    }
}

/// The commands of `scene` that can change a pixel of a white page: without the layers that hold
/// nothing, transparent fills, and white fills before anything else is drawn. `None` when a layer
/// composes other than by painting over what is under it (a mask, a blend mode, a filter): there
/// a layer holding nothing, or a fill, can still change what shows.
fn visible(scene: &Scene) -> Option<Vec<&RenderCommand>> {
    let mut out = Vec::with_capacity(scene.commands.len());
    // where each open layer's push is in `out`
    let mut open = Vec::new();
    // nothing but white drawn yet
    let mut blank = true;
    for c in &scene.commands {
        match c {
            RenderCommand::PushClipLayer(_) => {
                open.push(out.len());
                out.push(c);
            }
            RenderCommand::PushLayer(l) => {
                if l.blend != BlendMode::default()
                    || l.filter.is_some()
                    || l.backdrop_filter.is_some()
                {
                    return None;
                }
                open.push(out.len());
                out.push(c);
            }
            RenderCommand::PopLayer => {
                if open.pop()? + 1 == out.len() {
                    out.pop();
                } else {
                    out.push(c);
                }
            }
            RenderCommand::Fill(f)
                if matches!(&f.brush, Paint::Solid(color)
                    if color.components[3] == 0.0 || (blank && *color == Color::WHITE)) => {}
            _ => {
                blank = false;
                out.push(c);
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyrender::PaintScene as _;
    use peniko::{BlendMode, Color, Compose, Fill, Mix, kurbo::Affine, kurbo::Rect};

    const PAGE: Rect = Rect::new(0.0, 0.0, 100.0, 100.0);
    const BOX: Rect = Rect::new(10.0, 10.0, 20.0, 20.0);

    fn fill(s: &mut Scene, color: Color, r: Rect) {
        s.fill(Fill::NonZero, Affine::IDENTITY, color, None, &r);
    }
    fn clip(s: &mut Scene, r: Rect) {
        s.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &r);
    }
    fn layer(s: &mut Scene, blend: BlendMode, alpha: f32) {
        s.push_layer(
            Fill::NonZero,
            blend,
            alpha,
            Affine::IDENTITY,
            &PAGE,
            None,
            None,
        );
    }
    /// The frames Readest's reader draws while a book loads: its white page, then a black box.
    fn page() -> Scene {
        let mut s = Scene::new();
        fill(&mut s, Color::TRANSPARENT, PAGE);
        fill(&mut s, Color::WHITE, PAGE);
        s
    }

    // Each frame of a book opening had the same pixels as the last, with commands that differ:
    // clip layers that hold nothing, and the reader's white backgrounds on the white page.
    #[test]
    fn layers_holding_nothing_and_white_on_the_white_page_change_no_pixel() {
        let mut more = page();
        clip(&mut more, PAGE);
        fill(&mut more, Color::WHITE, PAGE);
        clip(&mut more, BOX);
        more.pop_layer();
        more.pop_layer();
        layer(&mut more, BlendMode::default(), 0.5);
        fill(&mut more, Color::TRANSPARENT, BOX);
        more.pop_layer();
        assert!(same_pixels(&page(), &more));
        assert!(same_pixels(&more, &page()));
    }

    #[test]
    fn what_shows_changes_pixels() {
        let mut boxed = page();
        clip(&mut boxed, PAGE);
        fill(&mut boxed, Color::BLACK, BOX);
        boxed.pop_layer();
        assert!(!same_pixels(&page(), &boxed));
        // white over the black box shows
        let mut covered = boxed.clone();
        fill(&mut covered, Color::WHITE, BOX);
        assert!(!same_pixels(&boxed, &covered));
        // a layer that holds nothing changes what it composes with when it doesn't paint over it
        let mut masked = page();
        layer(
            &mut masked,
            BlendMode::new(Mix::Normal, Compose::DestIn),
            1.0,
        );
        masked.pop_layer();
        assert!(!same_pixels(&page(), &masked));
    }
}
