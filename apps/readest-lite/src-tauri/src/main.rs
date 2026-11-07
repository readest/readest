//! Readest Lite: readest-app's frontend on tauri-runtime-blitz, with the plugins and commands its
//! startup reaches.

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

fn main() {
    tauri::Builder::<tauri_runtime_blitz::BlitzRuntime>::new()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            get_executable_dir,
            set_webview_info,
            is_updater_disabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
