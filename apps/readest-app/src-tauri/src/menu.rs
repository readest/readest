use tauri::menu::MenuEvent;
use tauri::menu::{SubmenuBuilder, HELP_SUBMENU_ID};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

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
    let opener = app.opener();
    if event.id() == "privacy_policy" {
        let _ = opener.open_url("https://readest.com/privacy-policy", None::<&str>);
    } else if event.id() == "report_issue" {
        let _ = opener.open_url("https://github.com/readest/readest/issues", None::<&str>);
    } else if event.id() == "readest_help" {
        let _ = opener.open_url("https://readest.com/support", None::<&str>);
    }
}
