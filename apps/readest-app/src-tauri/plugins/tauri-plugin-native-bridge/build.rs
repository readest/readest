const COMMANDS: &[&str] = &["auth_with_safari", "copy_uri_to_path"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
