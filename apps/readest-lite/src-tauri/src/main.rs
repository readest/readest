//! Readest Lite: readest-app's frontend on tauri-runtime-blitz, with the plugins and commands its
//! startup reaches.

use tauri_plugin_fs::FsExt;

/// Stubs of Readest's own commands (src-tauri/src/lib.rs) that the app service calls at start.
#[tauri::command]
fn get_executable_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

#[tauri::command]
fn set_webview_info(user_agent: String) {
    let _ = user_agent;
}

#[tauri::command]
fn is_updater_disabled() -> bool {
    true
}

/// Book paths (or `file://` URLs) from the command line, as readest-app's desktop build takes them.
fn files_from_args() -> Vec<std::path::PathBuf> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            url::Url::parse(&a)
                .ok()
                .and_then(|u| u.to_file_path().ok())
                .unwrap_or_else(|| a.into())
        })
        .collect()
}

fn main() {
    tauri::Builder::<tauri_runtime_blitz::BlitzRuntime>::new()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            get_executable_dir,
            set_webview_info,
            is_updater_disabled
        ])
        .setup(|app| {
            // Books opened with the app: readable through the fs plugin, and handed to the
            // library's open-with import (readest-app's `window.OPEN_WITH_FILES`).
            let files = files_from_args();
            for file in &files {
                app.fs_scope().allow_file(file)?;
            }
            let files: Vec<_> = files.iter().map(|f| f.to_string_lossy()).collect();
            let script = format!(
                "window.OPEN_WITH_FILES = {};",
                serde_json::to_string(&files)?
            );
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Readest Lite")
                .inner_size(494.0, 659.0)
                .initialization_script(&script)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
