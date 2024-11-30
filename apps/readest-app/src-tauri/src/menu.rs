use tauri::menu::MenuEvent;
use tauri::menu::{SubmenuBuilder, HELP_SUBMENU_ID};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub fn setup_macos_menu(app: &AppHandle) -> tauri::Result<()> {
    let global_menu = app.menu().unwrap();

    if let Some(item) = global_menu.get(HELP_SUBMENU_ID) {
        global_menu.remove(&item)?;
    }

    global_menu.append(
        &SubmenuBuilder::new(app, "Help")
            .text("privacy_policy", "Privacy Policy")
            .separator()
            .text("report_issue", "Report An Issue...")
            .text("readest_help", "Readest Help")
            .build()?,
    )?;

    app.on_menu_event(|app, event| {
        handle_menu_event(app, &event);
    });

    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    if event.id() == "privacy_policy" {
        if let Err(e) = app.shell().open("https://readest.com/privacy-policy", None) {
            eprintln!("Failed to open privacy policy: {}", e);
        }
    } else if event.id() == "report_issue" {
        if let Err(e) = app.shell().open("mailto:support@bilingify.com", None) {
            eprintln!("Failed to open mail client: {}", e);
        }
    } else if event.id() == "readest_help" {
        if let Err(e) = app.shell().open("https://readest.com/support", None) {
            eprintln!("Failed to open support page: {}", e);
        }
    }
}
