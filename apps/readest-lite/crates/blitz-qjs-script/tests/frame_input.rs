//! Input inside an iframe goes to the iframe's document, as Readest listens for taps and keys on
//! each section's document (and reports them to the page with `window.postMessage`).

use std::sync::Arc;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzKeyEvent, BlitzPointerEvent, BlitzPointerId, KeyState, MouseEventButton,
    MouseEventButtons, PointerCoords, PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

/// An iframe with a 5px border, 10px from the left edge of a container scrolled 100px to the
/// right (as foliate-js scrolls its container a page per turn).
const PAGE: &str = r#"<!DOCTYPE html><html><body style="margin: 0">
<div id="c" style="width: 200px; height: 100px; overflow: hidden">
  <div style="width: 600px; height: 100px; padding-left: 10px">
    <iframe style="border: 5px solid; width: 400px; height: 80px" srcdoc="<body style='margin: 0'><p id='p' style='margin: 0; height: 80px'>x</p></body>"></iframe>
  </div>
</div></body></html>"#;

fn load() -> QjsDocument {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(PAGE, config);
    let mut d = doc.inner_mut();
    d.resolve(0.0);
    let c = d.get_element_by_id("c").unwrap();
    d.scroll_to(c, 100.0, 0.0, blitz_dom::ScrollBehavior::Instant);
    d.resolve(0.0);
    drop(d);
    doc
}

fn finger(x: f32, y: f32, down: bool) -> UiEvent {
    let p = BlitzPointerEvent {
        id: BlitzPointerId::Finger(3),
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

fn key(name: &str, down: bool) -> UiEvent {
    let k = BlitzKeyEvent {
        key: name.parse().unwrap(),
        code: name.parse().unwrap(),
        modifiers: Default::default(),
        location: Default::default(),
        is_auto_repeating: false,
        is_composing: false,
        state: if down {
            KeyState::Pressed
        } else {
            KeyState::Released
        },
        text: None,
    };
    if down {
        UiEvent::KeyDown(k)
    } else {
        UiEvent::KeyUp(k)
    }
}

fn logs(doc: &mut QjsDocument) -> Vec<String> {
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

const LISTEN: &str = "
    const d = document.querySelector('iframe').contentDocument;
    const w = d.defaultView;
    const types = ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup'];
    for (const t of types) {
        d.addEventListener(t, (e) => {
            const at = e.clientX === undefined ? '' : ` ${e.clientX},${e.clientY}`;
            const touches = e.touches ? ` ${e.touches.length}/${e.changedTouches.length} ${e.changedTouches[0].identifier} ${e.changedTouches[0].clientX}` : '';
            const k = e.key ? ` ${e.key}` : '';
            console.log(t, e.target.id || e.target.localName, e.currentTarget === d, e.view === w, e.isTrusted + at + touches + k);
        });
        window.addEventListener(t, () => console.log('page', t));
    }
    w.addEventListener('click', (e) => console.log('frame window click', e.target.id));
";

#[test]
fn a_tap_in_an_iframe_reaches_its_document_in_frame_coordinates() {
    let mut doc = load();
    doc.eval(LISTEN, "test");
    // client (60, 20) is frame x 60 - (10 + 5 - 100) = 145, y 20 - 5 = 15
    doc.handle_ui_event(finger(60.0, 20.0, true));
    doc.handle_ui_event(finger(60.0, 20.0, false));
    assert_eq!(
        logs(&mut doc),
        [
            "pointerdown p true true true 145,15",
            "touchstart p true true true 1/1 3 145",
            "pointerup p true true true 145,15",
            "touchend p true true true 0/1 3 145",
            // a tap's compatibility mouse events (Readest times a long hold from mousedown)
            "mousedown p true true true 145,15",
            "mouseup p true true true 145,15",
            "click p true true true 145,15",
            "frame window click p",
        ]
    );
}

#[test]
fn keys_reach_the_focused_iframes_document() {
    let mut doc = load();
    doc.eval(LISTEN, "test");
    doc.handle_ui_event(finger(60.0, 20.0, true));
    doc.handle_ui_event(finger(60.0, 20.0, false));
    doc.take_messages();
    doc.handle_ui_event(key("ArrowRight", true));
    doc.handle_ui_event(key("ArrowRight", false));
    // With nothing focused Blitz targets the root element (a browser targets the body).
    assert_eq!(
        logs(&mut doc),
        [
            "keydown html true true true ArrowRight",
            "keyup html true true true ArrowRight",
        ]
    );
}

#[test]
fn window_post_message_fires_a_message_event_later() {
    let mut doc = load();
    doc.eval(
        "window.addEventListener('message', (e) => console.log(e.type, e instanceof MessageEvent, JSON.stringify(e.data), e.origin === location.origin, e.source === window));
        window.postMessage({ type: 'iframe-single-click', x: 1 }, '*');
        console.log('posted');
        const m = new MessageEvent('message', { data: 7 });
        console.log(m.data, m.origin, m.source);",
        "test",
    );
    doc.call_global("__blitzTimers", (1.0e12,));
    assert_eq!(
        logs(&mut doc),
        [
            "posted",
            "7  null",
            "message true {\"type\":\"iframe-single-click\",\"x\":1} true true",
        ]
    );
}
