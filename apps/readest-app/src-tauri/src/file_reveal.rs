//! Reveal in Folder, in place of the opener plugin's command (#6660).
//!
//! On Linux the plugin reveals through zbus's blocking API. The dialog
//! plugin's `xdg-portal` feature turns on zbus's `tokio` feature, and then
//! that API blocks on a tokio runtime of its own, which panics when the
//! plugin's async command calls it from a runtime worker thread: the reveal
//! never runs and the IPC call never settles. A blocking-pool thread is
//! outside the runtime, so the nested `block_on` works there.

use std::path::PathBuf;

#[tauri::command]
pub async fn reveal_item_in_dir(path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tauri_plugin_opener::reveal_item_in_dir(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::reveal_item_in_dir;

    // Called from inside the async runtime, as the IPC handler does. The bogus
    // bus address makes the reveal fail instead of opening a file manager; it
    // has to fail with an error, not panic on a nested tokio runtime (#6660).
    #[test]
    fn reveals_from_inside_the_async_runtime() {
        std::env::set_var(
            "DBUS_SESSION_BUS_ADDRESS",
            "unix:path=/nonexistent/readest-test-bus",
        );
        let result = tauri::async_runtime::block_on(reveal_item_in_dir(std::env::temp_dir()));
        assert!(result.is_err());
    }
}
