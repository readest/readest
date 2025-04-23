const COMMANDS: &[&str] = &[
    "auth_with_safari",
    "auth_with_custom_tab",
    "copy_uri_to_path",
    "use_background_audio",
    "install_package",
    "set_system_ui_visibility",
    "get_status_bar_height",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
