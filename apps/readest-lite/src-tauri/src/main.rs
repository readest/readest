//! Readest Lite: readest-app's frontend on tauri-runtime-blitz, with the plugins and commands its
//! startup reaches.

mod picker;

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

/// The plugins Readest Lite registers.
fn plugins<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_fs::init())
        // After fs: the paths a user grants (picked books, folders read in place, books opened
        // from the command line) stay readable after a relaunch, as in readest-app.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_turso::init())
        .plugin(picker::init())
}

fn main() {
    plugins(tauri::Builder::<tauri_runtime_blitz::BlitzRuntime>::new())
        .invoke_handler(tauri::generate_handler![
            get_executable_dir,
            set_webview_info,
            is_updater_disabled
        ])
        .setup(|app| {
            // Books opened with the app: readable through the fs plugin, and handed to the
            // library's open-with import (readest-app's `window.OPEN_WITH_FILES`). Lite has one
            // window and creates no others, so books open in it (`__READEST_SINGLE_WINDOW`).
            let files = files_from_args();
            for file in &files {
                app.fs_scope().allow_file(file)?;
            }
            let files: Vec<_> = files.iter().map(|f| f.to_string_lossy()).collect();
            let mut script = format!(
                "window.OPEN_WITH_FILES = {}; window.__READEST_SINGLE_WINDOW = true;",
                serde_json::to_string(&files)?
            );
            // READEST_LITE_EINK=1 (the Kindle launcher): Readest starts in its e-ink mode, as on
            // Android e-ink devices (`__READEST_IS_EINK`).
            if std::env::var("READEST_LITE_EINK").as_deref() == Ok("1") {
                script.push_str(" window.__READEST_IS_EINK = true;");
            }
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Readest Lite")
                .inner_size(494.0, 659.0)
                .initialization_script(&script)
                .initialization_script(include_str!("picker.js"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use tauri_plugin_fs::FsExt;

    /// A book picked in Import, a folder read in place or a book opened from the command line
    /// stays readable after a relaunch: Readest checks the file before opening it and offers to
    /// delete the book from the library when it can't.
    #[test]
    fn granted_paths_survive_a_relaunch() {
        let data = std::env::temp_dir().join(format!("readest-lite-scope-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        // Keeps the grant out of the real app data. SAFETY: the other test here reads the
        // environment only through std, which holds the same lock as set_var.
        unsafe { std::env::set_var("XDG_DATA_HOME", &data) };
        let launch = || {
            super::plugins(tauri::Builder::<tauri_runtime_blitz::BlitzRuntime>::new())
                .build(tauri::generate_context!())
                .unwrap()
        };
        let book = std::path::Path::new("/mnt/us/documents/novel.epub");
        let app = launch();
        assert!(!app.fs_scope().is_allowed(book));
        app.fs_scope().allow_file(book).unwrap();
        drop(app);
        let app = launch();
        assert!(
            app.fs_scope().is_allowed(book),
            "the grant is gone after a relaunch"
        );
        let _ = std::fs::remove_dir_all(&data);
    }
}
