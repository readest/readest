//! What is typed into a text field is its `value` by the time the `input` event runs, as in a
//! browser. Blitz edits the field's text natively; the value script read stayed the old one,
//! so a React-controlled field (Readest's search box, a note) put the old text back.

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{BlitzKeyEvent, KeyState, UiEvent};
use blitz_traits::shell::{ColorScheme, Viewport};

fn type_char(doc: &mut QjsDocument, c: &str) {
    for state in [KeyState::Pressed, KeyState::Released] {
        let k = BlitzKeyEvent {
            key: c.parse().unwrap(),
            code: "Unidentified".parse().unwrap(),
            modifiers: Default::default(),
            location: Default::default(),
            is_auto_repeating: false,
            is_composing: false,
            state,
            text: None,
        };
        doc.handle_ui_event(match state {
            KeyState::Pressed => UiEvent::KeyDown(k),
            KeyState::Released => UiEvent::KeyUp(k),
        });
    }
}

#[test]
fn a_typed_field_has_the_typed_value_in_its_input_handler() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><body><input id='i'><textarea id='t'></textarea></body></html>",
        config,
    );
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "for (const f of document.querySelectorAll('input, textarea'))
           f.addEventListener('input', (e) => console.log(e.target.id + ' ' + e.target.value));
         document.getElementById('i').focus();",
        "test",
    );
    type_char(&mut doc, "H");
    type_char(&mut doc, "i");
    doc.eval("document.getElementById('t').focus()", "test");
    type_char(&mut doc, "a");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(logs, ["i H", "i Hi", "t a"]);
}

/// React uses the `input` event only where `'oninput' in document`; else it falls back to old
/// IE's keydown/keyup polyfill, which threw on every key ("cannot read property 'tag' of null")
/// and left the search box's text unsearched. The document has the `on<event>` handler
/// properties elements have, and its handler runs for an event bubbling to it.
#[test]
fn the_document_has_event_handler_properties() {
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><body><input id='i'></body></html>",
        DocumentConfig::default(),
    );
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "console.log(['oninput' in document, 'onkeydown' in document, document.oninput].join(' '));
         document.oninput = (e) => console.log('document ' + e.target.id);
         document.getElementById('i').dispatchEvent(new Event('input', { bubbles: true }));",
        "test",
    );
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(logs, ["true true ", "document i"]);
}
