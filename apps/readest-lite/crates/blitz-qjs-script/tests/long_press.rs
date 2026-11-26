//! A finger held still on text selects the word under it, as Chromium's touch long press does:
//! Readest starts a selection on a touch screen from that (it opens its popup when the finger
//! lifts) and has no other way to on an e-ink screen, where double taps are off. The press then
//! gets a `contextmenu`, and its release no click. A finger that lifts sooner taps; one that moves
//! past the touch slop pans; neither selects. The words are the page's `Intl.Segmenter`'s (here a
//! stand-in that splits at spaces: the text is bullets, Blitz's one built-in font).

use std::sync::Arc;
use std::time::Duration;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
    PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

fn finger(x: f32, y: f32, down: Option<bool>) -> UiEvent {
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
        buttons: if down == Some(false) {
            MouseEventButtons::None
        } else {
            MouseEventButtons::Primary
        },
        mods: Default::default(),
        details: PointerDetails::default(),
        element: Default::default(),
        active_pointers: Arc::default(),
    };
    match down {
        Some(true) => UiEvent::PointerDown(p),
        None => UiEvent::PointerMove(p),
        Some(false) => UiEvent::PointerUp(p),
    }
}

/// Puts a finger on the second word, moves it `moved` px right, holds it `hold_ms` and lifts it:
/// the selection changes, context menus and clicks the page saw.
fn press(hold_ms: u64, moved: f32) -> Vec<String> {
    press_then_drag(hold_ms, moved, None)
}

/// `press`, with the finger then moved onto word `drag_to` (0, 1, 2) before it lifts.
fn press_then_drag(hold_ms: u64, moved: f32, drag_to: Option<usize>) -> Vec<String> {
    let html = "<!DOCTYPE html><html><body style='margin: 0; font: 16px/20px Bullet'>\
        <p id='p' style='margin: 0'>•• ◦◦◦ ▪▪</p></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 100, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "globalThis.Intl = { Segmenter: class {
          segment(t) { return [...t.matchAll(/\\S+|\\s+/g)].map((m) => ({ segment: m[0], index: m.index, isWordLike: /\\S/.test(m[0]) })); }
        } };
        document.addEventListener('selectionchange', () => console.log('selectionchange ' + document.getSelection()));
        document.addEventListener('contextmenu', (e) => console.log('contextmenu ' + e.pointerType));
        document.addEventListener('click', () => console.log('click'));
        const t = document.getElementById('p').firstChild;
        for (const at of [0, 4, 8]) {
          const r = document.createRange();
          r.setStart(t, at);
          r.setEnd(t, at + 1);
          const b = r.getBoundingClientRect();
          console.log('at ' + (b.x + b.width / 2) + ' ' + (b.y + b.height / 2));
        }",
        "test",
    );
    let logs = doc.take_messages();
    let words: Vec<(f32, f32)> = logs
        .iter()
        .filter_map(|m| m.strip_prefix("log: at "))
        .map(|at| {
            let (x, y) = at.split_once(' ').unwrap();
            (x.parse().unwrap(), y.parse().unwrap())
        })
        .collect();
    assert_eq!(words.len(), 3, "no points among {logs:?}");
    let (x, y) = words[1];
    doc.handle_ui_event(finger(x, y, Some(true)));
    if moved > 0.0 {
        doc.handle_ui_event(finger(x + moved, y, None));
    }
    std::thread::sleep(Duration::from_millis(hold_ms));
    doc.run_due_timers();
    let (x, y) = match drag_to {
        // over the way there, as a finger moves
        Some(w) => {
            let (tx, ty) = words[w];
            for i in 1..=4 {
                let f = i as f32 / 4.0;
                doc.handle_ui_event(finger(x + (tx - x) * f, y + (ty - y) * f, None));
            }
            (tx, ty)
        }
        None => (x + moved, y),
    };
    doc.handle_ui_event(finger(x, y, Some(false)));
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect()
}

#[test]
fn a_finger_held_still_selects_the_word_under_it() {
    assert_eq!(press(600, 0.0), ["selectionchange ◦◦◦", "contextmenu touch"]);
}

#[test]
fn a_finger_lifted_sooner_taps() {
    assert_eq!(press(100, 0.0), ["click"]);
}

#[test]
fn a_finger_moved_past_the_touch_slop_selects_nothing() {
    assert_eq!(press(600, 20.0), Vec::<String>::new());
}

// Chromium's touch selection: a finger moved after a long press drags the selection's end from
// word to word, the word held kept selected. On the Kindle that is the only way to select more
// than a word.
#[test]
fn a_finger_moved_after_a_long_press_selects_up_to_the_word_under_it() {
    assert_eq!(
        press_then_drag(600, 0.0, Some(2)),
        ["selectionchange ◦◦◦", "contextmenu touch", "selectionchange ◦◦◦ ▪▪"]
    );
    assert_eq!(
        press_then_drag(600, 0.0, Some(0)),
        ["selectionchange ◦◦◦", "contextmenu touch", "selectionchange •• ◦◦◦"]
    );
}
