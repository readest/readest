//! The first cycle collection waits for a large heap: Lite starts and opens a book with a heap that
//! is nearly all live, so collections on the way free little and each one walks the whole heap.
//! Past that heap they run as before.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;

/// Makes a cycle that only a collection frees, then keeps `mb` MB of ArrayBuffers alive, and says
/// whether a collection freed the cycle.
fn collected_after(mb: usize) -> bool {
    let mut doc = QjsDocument::from_html(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        DocumentConfig::default(),
    );
    doc.eval(
        &format!(
            "globalThis.collected = false;
            globalThis.registry = new FinalizationRegistry(() => {{ globalThis.collected = true; }});
            (() => {{ const o = {{}}; o.self = o; registry.register(o, 0); }})();
            globalThis.keep = [];
            for (let i = 0; i < {mb}; i++) keep.push(new ArrayBuffer(1 << 20));"
        ),
        "test",
    );
    doc.run_jobs();
    doc.eval("console.log('collected', collected)", "test");
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    match doc.take_messages().as_slice() {
        [m] => m == "log: collected true",
        other => panic!("unexpected console output: {other:?}"),
    }
}

#[test]
fn no_collection_while_the_heap_is_small() {
    assert!(!collected_after(48));
}

#[test]
fn collects_past_the_first_threshold() {
    assert!(collected_after(80));
}
