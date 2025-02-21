#[cfg(target_os = "macos")]
#[macro_use]
extern crate cocoa;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

#[cfg(target_os = "macos")]
mod menu;
#[cfg(target_os = "macos")]
mod traffic_light;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[cfg(desktop)]
use std::path::PathBuf;
#[cfg(desktop)]
use tauri::{AppHandle, Listener, Manager, Url};
#[cfg(desktop)]
use tauri_plugin_fs::FsExt;

mod transfer_file;
use tauri::{command, Emitter, WebviewUrl, WebviewWindowBuilder, Window};
use tauri_plugin_oauth::start;
use transfer_file::{download_file, upload_file};

#[cfg(desktop)]
fn allow_file_in_scopes(app: &AppHandle, files: Vec<PathBuf>) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    for file in &files {
        if let Err(e) = fs_scope.allow_file(file) {
            eprintln!("Failed to allow file in fs_scope: {}", e);
        } else {
            println!("Allowed file in fs_scope: {:?}", file);
        }
        if let Err(e) = asset_protocol_scope.allow_file(file) {
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

#[cfg(desktop)]
#[command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let font_collection = font_enumeration::Collection::new().unwrap();
    let mut fonts = Vec::new();
    for font in font_collection.all() {
        fonts.push(font.family_name.clone());
    }
    Ok(fonts)
}

#[derive(Clone, serde::Serialize)]
#[allow(dead_code)]
struct Payload {
    args: Vec<String>,
    cwd: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .invoke_handler(tauri::generate_handler![
            start_server,
            download_file,
            upload_file,
            #[cfg(desktop)]
            list_fonts
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let _ = app
            .get_webview_window("main")
            .expect("no main window")
            .set_focus();
        app.emit("single-instance", Payload { args: argv, cwd })
            .unwrap();
    }));

    let builder = builder.plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(traffic_light::init());

    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_sign_in_with_apple::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
        .setup(|#[allow(unused_variables)] app| {
            #[cfg(desktop)]
            {
                let mut files = Vec::new();
                // NOTICE: `args` may include URL protocol (`your-app-protocol://`)
                // or arguments (`--`) if your app supports them.
                // files may also be passed as `file://path/to/file`
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

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
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
                .resizable(true);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder
                .decorations(true)
                .title_bar_style(TitleBarStyle::Overlay)
                .title("");

            #[cfg(all(not(target_os = "macos"), desktop))]
            let win_builder = {
                let mut win_builder = win_builder
                    .decorations(false)
                    .transparent(true)
                    .visible(false)
                    .title("Readest");

                if cfg!(target_os = "windows") {
                    let version = tauri_plugin_os::version();
                    if version <= tauri_plugin_os::Version::from_string("10.0.19045") {
                        win_builder = win_builder.shadow(false);
                    } else {
                        win_builder = win_builder.shadow(true);
                    }
                } else {
                    win_builder = win_builder.shadow(true);
                }

                win_builder
            };

            win_builder.build().unwrap();
            // let win = win_builder.build().unwrap();
            // win.open_devtools();

            #[cfg(target_os = "macos")]
            menu::setup_macos_menu(app.handle())?;

            app.handle().emit("window-ready", ()).unwrap();

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
                    allow_file_in_scopes(app_handle, files.clone());
                    app_handle.listen("window-ready", move |_| {
                        println!("Window is ready, proceeding to handle files.");
                        set_window_open_with_files(&app_handler_clone, files.clone());
                    });
                }
            },
        );
}
