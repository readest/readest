//! Focus moves as in a browser, and key events go to the focused element. A tap focuses the
//! nearest focusable element (a button, or anything with a `tabindex`, -1 included) and leaves
//! none focused elsewhere; script's `focus()` and `blur()` move it, and `document.activeElement`
//! reports it. readest-app stops Escape where it is aimed: a dropdown's toggle button closes its
//! menu alone, a dialog (`tabindex=-1`, focused when it opens) closes itself alone. A press
//! focuses before the click, as on mousedown in a browser. Blitz focused
//! only text inputs and checkboxes on a tap and `focus()` only recorded the element for
//! `activeElement`, so the Escape reached the window and also closed the sidebar under them.
//! `:focus-visible` matches as in Chromium: after a key, or on a text input, not after a tap.

use std::sync::Arc;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzKeyEvent, BlitzPointerEvent, BlitzPointerId, KeyState, MouseEventButton,
    MouseEventButtons, PointerCoords, PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

const PAGE: &str = "<!DOCTYPE html><html><body style='margin:0'>
    <button id='btn' style='display:block; width:100px; height:40px; padding:0; border:0'></button>
    <div id='dlg' tabindex='-1' style='height:40px'></div>
    <div id='plain' style='height:40px'></div>
    </body></html>";

fn tap(doc: &mut QjsDocument, x: f32, y: f32) {
    for down in [true, false] {
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
        doc.handle_ui_event(if down {
            UiEvent::PointerDown(p)
        } else {
            UiEvent::PointerUp(p)
        });
    }
}

fn escape(doc: &mut QjsDocument) {
    doc.handle_ui_event(UiEvent::KeyDown(BlitzKeyEvent {
        key: "Escape".parse().unwrap(),
        code: "Escape".parse().unwrap(),
        modifiers: Default::default(),
        location: Default::default(),
        is_auto_repeating: false,
        is_composing: false,
        state: KeyState::Pressed,
        text: None,
    }));
}

#[test]
fn keys_go_to_the_element_a_tap_or_focus_focused() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(PAGE, config);
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "document.addEventListener('keydown', (e) => console.log(\
           'key ' + (e.target.id || e.target.localName) + ' active ' + (document.activeElement.id || document.activeElement.localName)));\
         document.getElementById('btn').addEventListener('click', () => console.log('click active ' + document.activeElement.id));",
        "test",
    );
    let step = |doc: &mut QjsDocument, script: Option<&str>, at: Option<(f32, f32)>| {
        if let Some((x, y)) = at {
            tap(doc, x, y);
        }
        if let Some(s) = script {
            doc.eval(s, "test");
        }
        escape(doc);
    };
    let by_id = |id: &str| format!("document.getElementById('{id}')");
    step(&mut doc, None, Some((50.0, 20.0)));
    step(&mut doc, None, Some((50.0, 100.0)));
    step(&mut doc, None, Some((50.0, 60.0)));
    step(
        &mut doc,
        Some(&format!("{}.focus()", by_id("dlg"))),
        Some((50.0, 100.0)),
    );
    step(&mut doc, Some(&format!("{}.blur()", by_id("dlg"))), None);
    step(&mut doc, Some(&format!("{}.focus()", by_id("plain"))), None);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            // focused by the press, before the click's handlers run (readest-app's bars show
            // themselves on focus, and a click on their buttons hides them)
            "click active btn",
            "key btn active btn",
            "key body active body",
            "key dlg active dlg",
            "key dlg active dlg",
            "key body active body",
            // not focusable: focus() does nothing
            "key body active body",
        ]
    );
}

#[test]
fn focus_shows_after_a_key_or_on_a_text_input_not_after_a_tap() {
    // readest-app rings the focused control with `:focus-visible` (Tailwind's
    // `focus-visible:ring-2`, daisyUI's buttons). Escape on a dropdown hands the focus back to its
    // toggle: Readest rings it, Lite never matched `:focus-visible`.
    let page = "<!DOCTYPE html><html><head><style>:focus-visible { outline: 2px solid black }</style>\
        </head><body style='margin:0'>\
        <button id='a' style='display:block; width:100px; height:40px; padding:0; border:0'></button>\
        <button id='b' style='display:block; width:100px; height:40px; padding:0; border:0'></button>\
        <input id='text' style='display:block; width:100px; height:40px; padding:0; border:0'>\
        </body></html>";
    let config = DocumentConfig {
        viewport: Some(Viewport::new(200, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(page, config);
    doc.inner_mut().resolve(0.0);
    let shown = |doc: &mut QjsDocument, label: &str| {
        doc.inner_mut().resolve(0.0);
        doc.eval(
            &format!(
                "{{ const f = document.activeElement; console.log('{label}: ' + f.id + ' ' + \
                 f.matches(':focus-visible') + ' ' + getComputedStyle(f).outlineStyle) }}"
            ),
            "test",
        );
    };
    tap(&mut doc, 50.0, 20.0);
    shown(&mut doc, "tap");
    escape(&mut doc);
    shown(&mut doc, "key");
    tap(&mut doc, 50.0, 60.0);
    shown(&mut doc, "tap");
    doc.eval("document.getElementById('a').focus()", "test");
    shown(&mut doc, "focus() after a tap");
    escape(&mut doc);
    doc.eval("document.getElementById('b').focus()", "test");
    shown(&mut doc, "focus() after a key");
    tap(&mut doc, 50.0, 100.0);
    shown(&mut doc, "tap");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            "tap: a false none",
            "key: a true solid",
            "tap: b false none",
            "focus() after a tap: a false none",
            "focus() after a key: b true solid",
            "tap: text true solid",
        ]
    );
}
