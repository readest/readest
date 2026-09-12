const COMMANDS: &[&str] = &[
    "list_voices",
    "download_voice",
    "cancel_download",
    "delete_voice",
    "load_voice",
    "unload_voice",
    "synthesize",
    "stop",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
