//! An error thrown from bytecode names its file and line, so a device log can be mapped to source:
//! both the runtime's bytecode cache and the frontend's shipped `.qjsc` (qjs-precompile) keep
//! QuickJS debug info.

use blitz_dom::DocumentConfig;
use blitz_qjs_script::QjsDocument;
use std::path::{Path, PathBuf};

const SRC: &str = "var x = 1;\nfunction boom() { throw new Error('boom'); }\n\
try { boom(); } catch (e) { console.log(e.stack); }\n";

/// Runs `/app.js` from `dir` (and `/app.js.qjsc` when there) through the script loader.
fn run(dir: &Path, cache: Option<PathBuf>) -> Vec<String> {
    let html = "<!DOCTYPE html><html><body><script src='/app.js'></script></body></html>";
    let config = DocumentConfig {
        base_url: Some("app://host/".into()),
        ..Default::default()
    };
    let mut doc = QjsDocument::from_html(html, config);
    let dir = dir.to_owned();
    doc.set_script_loader(Box::new(move |u| {
        std::fs::read(dir.join(&u.path()[1..])).ok()
    }));
    doc.set_bytecode_cache_dir(cache);
    doc.execute_scripts();
    assert_eq!(doc.take_js_errors(), Vec::<String>::new());
    doc.take_messages()
}

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("qjs-stacks-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("app.js"), SRC).unwrap();
    d
}

#[test]
fn cached_bytecode_keeps_lines() {
    let dir = scratch("cache");
    let cache = dir.join("cache");
    let first = run(&dir, Some(cache.clone()));
    assert!(first[0].contains("app://host/app.js:2"), "{first:?}");
    // Second run reads the bytecode the first one cached.
    assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    let second = run(&dir, Some(cache));
    assert!(second[0].contains("app://host/app.js:2"), "{second:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn shipped_bytecode_keeps_lines() {
    let dir = scratch("shipped");
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_qjs-precompile"))
        .arg(&dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    // Runs from app.js.qjsc: the source is gone.
    std::fs::write(dir.join("app.js"), "throw new Error('source ran');").unwrap();
    let logs = run(&dir, None);
    // Named by its path under the frontend dir, as in the source maps.
    assert!(logs[0].contains("/app.js:2"), "{logs:?}");
    assert!(!logs[0].contains(&*dir.to_string_lossy()), "{logs:?}");
    let _ = std::fs::remove_dir_all(&dir);
}
