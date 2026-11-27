//! `<input type=range>` takes its value from a press and a drag, as in a browser: the press
//! sets it from where it lands, a drag moves it, `input` fires as it changes and `change` when
//! the finger lifts; values snap to the step, and a right-to-left range runs from the right.
//! Blitz has no range control, and Readest draws each slider (font size, page position,
//! brightness) over an invisible one: in Lite no slider moved.

use std::sync::Arc;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
    PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

const RANGE: &str = "display:block; width:200px; height:20px; margin:0; padding:0; border:0";

fn finger(doc: &mut QjsDocument, kind: &str, x: f32, y: f32) {
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
        buttons: if kind == "up" {
            MouseEventButtons::None
        } else {
            MouseEventButtons::Primary
        },
        mods: Default::default(),
        details: PointerDetails::default(),
        element: Default::default(),
        active_pointers: Arc::default(),
    };
    doc.handle_ui_event(match kind {
        "down" => UiEvent::PointerDown(p),
        "move" => UiEvent::PointerMove(p),
        _ => UiEvent::PointerUp(p),
    });
}

#[test]
fn a_range_takes_its_value_from_a_press_and_a_drag() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let html = format!(
        "<!DOCTYPE html><html><body style='margin:0'>
         <input id='r' type='range' min='10' max='30' step='2' value='20' style='{RANGE}'>
         <div dir='rtl'><input id='l' type='range' style='{RANGE}'></div>
         </body></html>"
    );
    let mut doc = QjsDocument::from_html(&html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const t of ['input', 'change'])
           document.addEventListener(t, (e) => console.log(t + ' ' + e.target.id + ' ' + e.target.value));",
        "test",
    );
    // A tap 70% of the way along: 10 + 0.7 * 20 = 24.
    finger(&mut doc, "down", 140.0, 10.0);
    finger(&mut doc, "up", 140.0, 10.0);
    // A drag from 10% (12) through the middle (20) to past the end (30).
    finger(&mut doc, "down", 20.0, 10.0);
    finger(&mut doc, "move", 100.0, 10.0);
    finger(&mut doc, "move", 250.0, 12.0);
    finger(&mut doc, "up", 250.0, 12.0);
    // Right to left, 0 to 100, the box against the right edge (100 to 300): a quarter of the
    // way from its left is 75.
    finger(&mut doc, "down", 150.0, 30.0);
    finger(&mut doc, "up", 150.0, 30.0);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            "input r 24",
            "change r 24",
            "input r 12",
            "input r 20",
            "input r 30",
            "change r 30",
            "input l 75",
            "change l 75",
        ]
    );
}
