//! A text field's selection is script's to set and read, in UTF-16 units as in a browser:
//! `select()`, `setSelectionRange()`, `selectionStart`/`selectionEnd`, and what is typed next
//! replaces it. Readest selects a field's text when it opens the book search (main's #7634),
//! when a number setting is focused and when a name is edited; Lite's fields had none of these,
//! and opening the search bar crashed the reader to its error page.

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
fn script_selects_a_fields_text_and_typing_replaces_it() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(300, 200, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(
        // Blitz's built-in font: the test has no system fonts, and a field laid out with no font
        // has no clusters to put a selection's ends on.
        "<!DOCTYPE html><html><body style='font: 16px Bullet'><input id='i' value='héllo wörld' style='font: inherit'><textarea id='t' style='font: inherit'>ab😀cd</textarea></body></html>",
        config,
    );
    doc.inner_mut().resolve(0.0);
    doc.eval(
        "const i = document.getElementById('i'), t = document.getElementById('t');
         const at = (f) => console.log(f.id + ' ' + f.selectionStart + ' ' + f.selectionEnd);
         i.addEventListener('input', () => console.log('input ' + i.value));
         i.select(); at(i);
         i.setSelectionRange(1, 4); at(i);
         i.setSelectionRange(4, 1); at(i);
         t.setSelectionRange(2, 4); at(t);
         i.focus(); i.setSelectionRange(0, 5);",
        "test",
    );
    type_char(&mut doc, "H");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        ["i 0 11", "i 1 4", "i 1 1", "t 2 4", "input H wörld"]
    );
}
