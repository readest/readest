const COMMANDS: &[&str] = &[
    "init",
    "speak",
    "stop",
    "pause",
    "resume",
    "set_rate",
    "set_pitch",
    "set_voice",
    "get_all_voices",
    "set_media_session_active",
    "update_media_session_state",
    "update_media_session_metadata",
    "register_listener",
    "remove_listener",
    "check_permissions",
    "request_permissions",
    "checkPermissions",
    "requestPermissions",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
