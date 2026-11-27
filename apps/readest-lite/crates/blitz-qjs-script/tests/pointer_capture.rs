//! Pointer capture, as in a browser: once an element captures a pointer, that pointer's moves and
//! its release go to the element wherever the pointer is, in the element's own client
//! coordinates, until it lifts or the capture is released. Readest's selection handles capture
//! the finger that drags them; Lite had no `setPointerCapture`, so every handle drag threw and
//! the selection could not be extended (on the Kindle, highlighting a passage failed).

use std::sync::Arc;

use blitz_dom::{Document as _, DocumentConfig};
use blitz_qjs_script::QjsDocument;
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, MouseEventButton, MouseEventButtons, PointerCoords,
    PointerDetails, UiEvent,
};
use blitz_traits::shell::{ColorScheme, Viewport};

fn finger(doc: &mut QjsDocument, kind: &str, x: f32, y: f32) {
    let p = BlitzPointerEvent {
        id: BlitzPointerId::Finger(0),
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
fn a_captured_pointer_goes_to_its_element_until_it_lifts() {
    let config = DocumentConfig {
        viewport: Some(Viewport::new(400, 400, 1.0, ColorScheme::Light)),
        ..DocumentConfig::default()
    };
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><body style='margin:0'>
         <div id='h' style='position:absolute; left:0; top:0; width:20px; height:20px'></div>
         <iframe style='position:absolute; left:50px; top:100px; width:300px; height:200px; border:0'
           srcdoc=\"<body style='margin:0; height:200px'></body>\"></iframe>
         </body></html>",
        config,
    );
    doc.inner_mut().resolve(0.0);
    doc.call_global("__blitzAfterLayout", ());
    doc.eval(
        "const h = document.getElementById('h');
         const log = (e) => console.log(`${e.type} ${e.target.id || e.target.nodeName} ${e.clientX},${e.clientY} ${h.hasPointerCapture(e.pointerId)}`);
         h.addEventListener('pointerdown', (e) => { e.target.setPointerCapture(e.pointerId); log(e); });
         h.addEventListener('pointermove', log);
         h.addEventListener('pointerup', (e) => { log(e); e.target.releasePointerCapture(e.pointerId); });
         document.querySelector('iframe').contentDocument.addEventListener('pointermove', (e) => console.log(`frame ${e.clientX},${e.clientY}`));",
        "test",
    );
    doc.inner_mut().resolve(0.0);
    // Down on the handle, then over the iframe (its own (10,50)), then over the page.
    finger(&mut doc, "down", 10.0, 10.0);
    finger(&mut doc, "move", 60.0, 150.0);
    finger(&mut doc, "move", 250.0, 30.0);
    finger(&mut doc, "up", 250.0, 30.0);
    // Lifted: the next press over the iframe is the iframe's.
    finger(&mut doc, "down", 60.0, 150.0);
    finger(&mut doc, "move", 70.0, 160.0);
    finger(&mut doc, "up", 70.0, 160.0);
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    let logs: Vec<String> = doc
        .take_messages()
        .into_iter()
        .filter_map(|m| m.strip_prefix("log: ").map(str::to_owned))
        .collect();
    assert_eq!(
        logs,
        [
            "pointerdown h 10,10 true",
            "pointermove h 60,150 true",
            "pointermove h 250,30 true",
            "pointerup h 250,30 true",
            "frame 20,60",
        ]
    );
}
