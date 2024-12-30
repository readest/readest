#[cfg(target_os = "macos")]
#[macro_use]
extern crate cocoa;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

#[cfg(target_os = "macos")]
mod menu;
#[cfg(target_os = "macos")]
mod tauri_traffic_light_positioner_plugin;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

use std::path::PathBuf;
use tauri::{command, Window};
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog;
use tauri_plugin_fs::FsExt;
use tauri_plugin_oauth::start;

#[cfg(desktop)]
use tauri::Listener;

#[cfg(desktop)]
fn allow_file_in_scopes(app: &AppHandle, files: Vec<PathBuf>) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    for file in &files {
        if let Err(e) = fs_scope.allow_file(&file) {
            eprintln!("Failed to allow file in fs_scope: {}", e);
        } else {
            println!("Allowed file in fs_scope: {:?}", file);
        }
        if let Err(e) = asset_protocol_scope.allow_file(&file) {
            eprintln!("Failed to allow file in asset_protocol_scope: {}", e);
        } else {
            println!("Allowed file in asset_protocol_scope: {:?}", file);
        }
    }
}

#[cfg(desktop)]
fn set_window_open_with_files(app: &AppHandle, files: Vec<PathBuf>) {
    let files = files
        .into_iter()
        .map(|f| {
            let file = f.to_string_lossy().replace("\\", "\\\\");
            format!("\"{file}\"",)
        })
        .collect::<Vec<_>>()
        .join(",");
    let window = app.get_webview_window("main").unwrap();
    let script = format!("window.OPEN_WITH_FILES = [{}];", files);
    if let Err(e) = window.eval(&script) {
        eprintln!("Failed to set open files variable: {}", e);
    }
}

#[command]
async fn start_server(window: Window) -> Result<u16, String> {
    start(move |url| {
        // Because of the unprotected localhost port, you must verify the URL here.
        // Preferebly send back only the token, or nothing at all if you can handle everything else in Rust.
        let _ = window.emit("redirect_uri", url);
    })
    .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .invoke_handler(tauri::generate_handler![start_server])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_traffic_light_positioner_plugin::init());

    builder
        .setup(|#[allow(unused_variables)] app| {
            #[cfg(desktop)]
            {
                let mut files = Vec::new();
                // NOTICE: `args` may include URL protocol (`your-app-protocol://`)
                // or arguments (`--`) if your app supports them.
                // files may aslo be passed as `file://path/to/file`
                for maybe_file in std::env::args().skip(1) {
                    // skip flags like -f or --flag
                    if maybe_file.starts_with("-") {
                        continue;
                    }
                    // handle `file://` path urls and skip other urls
                    if let Ok(url) = Url::parse(&maybe_file) {
                        if let Ok(path) = url.to_file_path() {
                            files.push(path);
                        } else {
                            files.push(PathBuf::from(maybe_file))
                        }
                    } else {
                        files.push(PathBuf::from(maybe_file))
                    }
                }
                if !files.is_empty() {
                    let app_handle = app.handle().clone();
                    allow_file_in_scopes(&app_handle, files.clone());
                    app.listen("window-ready", move |_| {
                        println!("Window is ready, proceeding to handle files.");
                        set_window_open_with_files(&app_handle, files.clone());
                    });
                }
            }

            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_cli::init())?;

                let app_handle = app.handle().clone();
                app.listen("window-ready", move |_| {
                    app_handle.get_webview_window("main").unwrap()
                        .eval("window.__READEST_CLI_ACCESS = true; window.__READEST_UPDATER_ACCESS = true;")
                        .expect("Failed to set cli access config");
                });
            }

            #[cfg(desktop)]
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default());

            #[cfg(desktop)]
            let win_builder = win_builder
                .inner_size(800.0, 600.0)
                .resizable(true)
                .maximized(true);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder
                .decorations(true)
                .title_bar_style(TitleBarStyle::Overlay)
                .title("");

            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = win_builder
                .decorations(false)
                .transparent(true)
                .title("Readest");

            win_builder.build().unwrap();
            // let win = win_builder.build().unwrap();
            // win.open_devtools();

            #[cfg(target_os = "macos")]
            menu::setup_macos_menu(&app.handle())?;

            app.handle().emit("window-ready", {}).unwrap();

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Opened { urls } = event {
                    let files = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .collect::<Vec<_>>();

                    let app_handler_clone = app_handle.clone();
                    allow_file_in_scopes(&app_handle, files.clone());
                    app_handle.listen("window-ready", move |_| {
                        println!("Window is ready, proceeding to handle files.");
                        set_window_open_with_files(&app_handler_clone, files.clone());
                    });
                }
            },
        );
}
