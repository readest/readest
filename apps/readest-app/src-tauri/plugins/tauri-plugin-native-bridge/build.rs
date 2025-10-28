const COMMANDS: &[&str] = &[
    "auth_with_safari",
    "auth_with_custom_tab",
    "copy_uri_to_path",
    "use_background_audio",
    "install_package",
    "set_system_ui_visibility",
    "get_status_bar_height",
    "get_sys_fonts_list",
    "intercept_keys",
    "lock_screen_orientation",
    "iap_initialize",
    "iap_fetch_products",
    "iap_purchase_product",
    "iap_restore_purchases",
    "get_system_color_scheme",
    "get_safe_area_insets",
    "get_screen_brightness",
    "set_screen_brightness",
    "get_external_sdcard_path",
    "request_manage_storage_permission",
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
