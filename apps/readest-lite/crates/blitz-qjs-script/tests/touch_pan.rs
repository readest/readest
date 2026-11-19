//! A finger that moves more than Chromium's touch slop (15 CSS px) pans the scroller under it and
//! clicks nothing; one that moves less is a tap and clicks. Blitz panned after 2 px, so on a touch
//! screen a tap whose finger shifted a few pixels lost its click. Chromium (CDP touch events,
//! scale 2) clicks after a move of 0 to 15 px and scrolls after 16 px or more. The pan starts
//! where the finger crosses the slop, so the scroller follows only the movement after that
//! (Chromium also counts about 6 px of the slop).

use std::sync::Arc;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
    PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

#[derive(Clone, Copy)]
enum Phase {
    Down,
    Move,
    Up,
}

fn finger(x: f32, y: f32, phase: Phase) -> UiEvent {
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
        buttons: match phase {
            Phase::Up => MouseEventButtons::None,
            _ => MouseEventButtons::Primary,
        },
        mods: Default::default(),
        details: PointerDetails::default(),
        element: Default::default(),
        active_pointers: Arc::default(),
    };
    match phase {
        Phase::Down => UiEvent::PointerDown(p),
        Phase::Move => UiEvent::PointerMove(p),
        Phase::Up => UiEvent::PointerUp(p),
    }
}

/// Puts a finger on the button in a scroller, moves it `d` px up in 5 steps and lifts it: whether
/// the button was clicked, and how far the scroller scrolled.
fn swipe(d: f32) -> (bool, f64) {
    let html = "<!DOCTYPE html><html><body style='margin: 0'>\
        <div id='s' style='position: absolute; left: 10px; top: 10px; width: 200px; height: 300px; overflow: auto'>\
        <button id='b' style='display: block; width: 180px; height: 100px'>b</button><div style='height: 1000px'></div></div>\
        </body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 500, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.eval(
        "window.clicked = false; document.getElementById('b').onclick = () => { clicked = true };",
        "test",
    );
    doc.inner_mut().resolve(0.0);
    let (x, y) = (100.0, 60.0);
    doc.handle_ui_event(finger(x, y, Phase::Down));
    for i in 1..=5 {
        doc.handle_ui_event(finger(x, y - d * i as f32 / 5.0, Phase::Move));
    }
    doc.handle_ui_event(finger(x, y - d, Phase::Up));
    doc.take_messages();
    doc.eval(
        "console.log(clicked + ' ' + document.getElementById('s').scrollTop)",
        "test",
    );
    let messages = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let log = messages
        .iter()
        .find_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .unwrap_or_else(|| panic!("no log among {messages:?}"));
    let (clicked, top) = log.split_once(' ').unwrap();
    (clicked == "true", top.parse().unwrap())
}

#[test]
fn a_finger_that_moves_within_the_touch_slop_taps() {
    for d in [0.0, 3.0, 8.0, 15.0] {
        assert_eq!(swipe(d), (true, 0.0), "moved {d} px");
    }
}

#[test]
fn a_finger_that_moves_past_the_touch_slop_scrolls() {
    assert!(!swipe(16.0).0, "moved 16 px: clicked");
    for d in [20.0, 40.0] {
        let (clicked, top) = swipe(d);
        assert!(
            !clicked && top > 0.0,
            "moved {d} px: clicked {clicked}, scrolled {top}"
        );
    }
}

/// Puts a finger on a plain box, moves it `d` px right in 5 steps and lifts it: how many
/// `touchmove` events the page saw, and whether it clicked.
fn drag_on_box(d: f32) -> (usize, bool) {
    let html = "<!DOCTYPE html><html><body style='margin: 0'><div id='t' style='width: 300px; height: 300px'></div></body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 500, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    doc.eval(
        "window.moves = 0; window.clicked = false; const t = document.getElementById('t');
        t.addEventListener('touchmove', () => moves++); t.onclick = () => { clicked = true };",
        "test",
    );
    doc.inner_mut().resolve(0.0);
    let (x, y) = (100.0, 150.0);
    doc.handle_ui_event(finger(x, y, Phase::Down));
    for i in 1..=5 {
        doc.handle_ui_event(finger(x + d * i as f32 / 5.0, y, Phase::Move));
    }
    doc.handle_ui_event(finger(x + d, y, Phase::Up));
    doc.take_messages();
    doc.eval("console.log(moves + ' ' + clicked)", "test");
    let messages = doc.take_messages();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let log = messages
        .iter()
        .find_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .unwrap_or_else(|| panic!("no log among {messages:?}"));
    let (moves, clicked) = log.split_once(' ').unwrap();
    (moves.parse().unwrap(), clicked == "true")
}

// Chromium sends no `touchmove` until the finger leaves the touch slop (when `touchstart` wasn't
// cancelled), so a page's swipe handling never sees a tap's shift: foliate-js's paginator
// handled a tap that shifted 3px as a swipe and Readest's tap-to-turn never got the click.
#[test]
fn touchmove_waits_for_the_finger_to_leave_the_touch_slop() {
    let got = [3.0, 15.0, 20.0, 40.0].map(drag_on_box);
    assert_eq!(got, [(0, true), (0, true), (2, false), (4, false)]);
}
