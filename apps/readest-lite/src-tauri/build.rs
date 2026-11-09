fn main() {
    // The dialog plugin is Lite's own (src/picker.rs); its commands need ACL permissions.
    let dialog = tauri_build::InlinedPlugin::new()
        .commands(&["open", "pick", "list_dir"])
        .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands);
    tauri_build::try_build(tauri_build::Attributes::new().plugin("dialog", dialog))
        .expect("failed to run tauri-build");
}
