//! Defensive sanitizer for the `.window-state.json` file written by
//! `tauri-plugin-window-state`.
//!
//! On Windows a minimized window reports its position as `(-32000, -32000)`
//! and its size as `0x0`. The plugin already guards against persisting those
//! values, but a state file written by an older build (or a future
//! regression) can still contain them, and WebView2 then rejects the restored
//! bounds with `0x80070057` ("The parameter is incorrect"), leaving the app
//! unable to launch. See https://github.com/readest/readest/issues/4398.
//!
//! This module strips any window entry with invalid geometry from the state
//! file *before* the window-state plugin loads it, so the affected window
//! falls back to its default position and size instead of crashing.

use std::path::Path;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Default filename used by `tauri-plugin-window-state`.
const STATE_FILENAME: &str = ".window-state.json";

/// Windows parks a minimized window at exactly `(-32000, -32000)`. Real
/// monitors sit only a few thousand pixels off the origin even in multi-display
/// setups (a 4K display left of the primary is `-3840`), so a saved coordinate
/// at or below `-16000` — roughly halfway to the sentinel and well past any
/// normal desktop — is the minimize marker rather than a real position. A
/// normal negative like `-1920` stays well above the cutoff and is kept.
const MIN_VALID_COORD: i64 = -16000;

/// Returns a sanitized copy of the window-state JSON when one or more window
/// entries have invalid geometry, or `None` when nothing needs to change
/// (already valid, empty, or unparseable).
fn sanitize_json(content: &str) -> Option<String> {
    let mut windows: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(content).ok()?;
    let before = windows.len();
    windows.retain(|_, state| has_valid_geometry(state));
    if windows.len() == before {
        return None;
    }
    serde_json::to_string_pretty(&windows).ok()
}

/// A window entry is only usable if it has a positive size and an on-screen
/// position. Missing fields are treated as valid so a schema change never
/// drops an otherwise-good entry.
fn has_valid_geometry(state: &serde_json::Value) -> bool {
    let int = |key: &str, default: i64| {
        state
            .get(key)
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(default)
    };
    int("width", 1) > 0
        && int("height", 1) > 0
        && int("x", 0) > MIN_VALID_COORD
        && int("y", 0) > MIN_VALID_COORD
}

/// Reads, sanitizes, and rewrites the window-state file at `path`. Removes the
/// file entirely when sanitizing leaves no valid entries.
fn sanitize_file(path: &Path) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    let Some(sanitized) = sanitize_json(&content) else {
        return;
    };
    log::warn!("Removing invalid window geometry from {}", path.display());
    if sanitized.trim() == "{}" {
        let _ = std::fs::remove_file(path);
    } else {
        let _ = std::fs::write(path, sanitized);
    }
}

/// Tauri plugin that sanitizes the saved window state during setup. Register it
/// immediately **before** `tauri-plugin-window-state` so the bad geometry is
/// gone before that plugin loads the file.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("window-state-sanitizer")
        .setup(|app, _api| {
            if let Ok(dir) = app.path().app_config_dir() {
                sanitize_file(&dir.join(STATE_FILENAME));
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::sanitize_json;

    const VALID: &str = r#"{"main":{"width":1280,"height":800,"x":100,"y":100,"prev_x":0,"prev_y":0,"maximized":false,"visible":true,"decorated":true,"fullscreen":false}}"#;

    #[test]
    fn keeps_valid_state() {
        assert!(sanitize_json(VALID).is_none());
    }

    #[test]
    fn keeps_negative_multi_monitor_position() {
        // A monitor to the left yields a legitimately negative x (e.g. -1920).
        let json = r#"{"main":{"width":1280,"height":800,"x":-1920,"y":0}}"#;
        assert!(sanitize_json(json).is_none());
    }

    #[test]
    fn keeps_deep_multi_monitor_position() {
        // Even a few stacked displays left of the primary stay well above the
        // cutoff (three 4K monitors reach only ~ -11520).
        let json = r#"{"main":{"width":1280,"height":800,"x":-11520,"y":0}}"#;
        assert!(sanitize_json(json).is_none());
    }

    #[test]
    fn drops_minimized_sentinel_position() {
        let json = r#"{"main":{"width":800,"height":600,"x":-32000,"y":-32000}}"#;
        assert_eq!(sanitize_json(json).as_deref().map(str::trim), Some("{}"));
    }

    #[test]
    fn drops_zero_size() {
        let json = r#"{"main":{"width":0,"height":0,"x":100,"y":100}}"#;
        assert!(sanitize_json(json).is_some());
    }

    #[test]
    fn keeps_good_entry_drops_bad_entry() {
        let json = r#"{"good":{"width":1280,"height":800,"x":0,"y":0},"bad":{"width":0,"height":0,"x":-32000,"y":-32000}}"#;
        let out = sanitize_json(json).expect("file changed");
        assert!(out.contains("good"));
        assert!(!out.contains("bad"));
    }

    #[test]
    fn ignores_unparseable_content() {
        assert!(sanitize_json("not json").is_none());
    }
}
