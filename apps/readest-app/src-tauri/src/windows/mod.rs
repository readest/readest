mod explorer_thumbnails;

#[tauri::command]
pub fn get_explorer_thumbnails_enabled() -> Result<bool, String> {
    explorer_thumbnails::get_explorer_thumbnails_enabled()
}

#[tauri::command]
pub fn set_explorer_thumbnails_enabled(enabled: bool) -> Result<(), String> {
    explorer_thumbnails::set_explorer_thumbnails_enabled(enabled)
}
