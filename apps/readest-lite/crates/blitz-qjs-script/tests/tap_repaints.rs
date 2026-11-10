//! A tap that changes nothing on screen asks for no paint. A page turn on a Kindle is a tap on
//! the book's text: Blitz asked for a repaint when the finger landed (hover moved and a collapsed
//! text selection was set) and again when it lifted (hover cleared). Each painted and presented a
//! frame identical to the one before (~150 ms on a Voyage), and the first one held back the
//! pointer-up, so the page turned later.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
    PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, ShellProvider, Viewport};

#[derive(Default)]
struct Requests {
    redraws: AtomicUsize,
    restyles: AtomicUsize,
}
impl ShellProvider for Requests {
    fn request_redraw(&self) {
        self.redraws.fetch_add(1, Ordering::Relaxed);
    }
    fn request_restyle(&self) {
        self.restyles.fetch_add(1, Ordering::Relaxed);
    }
}

// Text in Blitz's built-in bullet font, the only font a document has without system fonts: two
// 20px lines.
fn load(style: &str) -> (QjsDocument, Arc<Requests>) {
    let html = format!(
        "<!DOCTYPE html><html><head><style>{style}</style></head>\
         <body style='margin: 0; font: 16px/20px Bullet'>\
         <p id='p' style='margin: 0'>••••••</p><p id='q' style='margin: 0'>••••••</p>\
         </body></html>"
    );
    let requests = Arc::new(Requests::default());
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 200, 1.0, ColorScheme::Light)),
        shell_provider: Some(requests.clone()),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    (doc, requests)
}

fn finger(x: f32, y: f32, down: bool) -> UiEvent {
    let p = BlitzPointerEvent {
        id: BlitzPointerId::Finger(1),
        is_primary: true,
        coords: PointerCoords {
            page_x: x,
            page_y: y,
            screen_x: x,
            screen_y: y,
            client_x: x,
            client_y: y,
        },
        button: MouseEventButton::Main,
        buttons: if down {
            MouseEventButtons::Primary
        } else {
            MouseEventButtons::None
        },
        mods: Default::default(),
        details: PointerDetails::default(),
        element: Default::default(),
        active_pointers: Arc::default(),
    };
    if down {
        UiEvent::PointerDown(p)
    } else {
        UiEvent::PointerUp(p)
    }
}

fn tap(doc: &mut QjsDocument, x: f32, y: f32) {
    doc.handle_ui_event(finger(x, y, true));
    doc.handle_ui_event(finger(x, y, false));
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
}

#[test]
fn a_tap_on_text_that_shows_no_hover_or_selection_paints_nothing() {
    let (mut doc, requests) = load("");
    let redraws = || requests.redraws.load(Ordering::Relaxed);
    let before = redraws();
    tap(&mut doc, 20.0, 5.0);
    assert_eq!(redraws(), before);
    // what a restyle request leaves to resolve damages nothing
    doc.inner_mut().resolve(0.0);
    assert!(!doc.inner().damaged_by_last_resolve());
}

#[test]
fn a_tap_on_text_with_a_hover_style_repaints_it() {
    let (mut doc, requests) = load("#p:hover { color: red }");
    let paints =
        || requests.redraws.load(Ordering::Relaxed) + requests.restyles.load(Ordering::Relaxed);
    let before = paints();
    doc.handle_ui_event(finger(20.0, 5.0, true));
    assert!(paints() > before);
    doc.inner_mut().resolve(0.0);
    assert!(doc.inner().damaged_by_last_resolve());
}

#[test]
fn a_tap_that_clears_a_highlighted_selection_repaints() {
    let (mut doc, requests) = load("");
    let p = doc.inner().get_element_by_id("p").unwrap();
    let text = doc.inner().get_node(p).unwrap().children[0];
    let root = doc
        .inner()
        .get_node(text)
        .unwrap()
        .inline_root_ancestor()
        .unwrap()
        .id;
    doc.inner_mut().set_text_selection(root, 0, root, 4);
    assert!(doc.inner().has_text_selection());
    let redraws = || requests.redraws.load(Ordering::Relaxed);
    let before = redraws();
    tap(&mut doc, 20.0, 25.0);
    assert!(!doc.inner().has_text_selection());
    assert!(redraws() > before);
}
