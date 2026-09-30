//! Hands a relaunch to the running Readest before CEF starts (#6394).
//!
//! Chromium's process singleton sees a second launch on the same profile
//! first: it passes the command line to the running browser process, where
//! the CEF runtime drops it, and this process then fails CEF initialization
//! and panics. The single-instance plugin's D-Bus handoff runs later, during
//! `Builder::build`, so it never gets the chance: a relaunch neither raises
//! the library nor opens the files it was given. Calling the plugin's D-Bus
//! method up front delivers the launch the same way the plugin would.

/// The single-instance plugin's well-known name and object path for `dbus_id`.
fn dbus_name_and_path(dbus_id: &str) -> (String, String) {
    let name = format!("{dbus_id}.SingleInstance");
    let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
    (name, path)
}

/// Forwards this launch's argv and cwd to a running instance and exits, or
/// returns when none is running.
#[cfg(feature = "cef")]
pub fn forward_to_running_instance(dbus_id: &str) {
    let Ok(connection) = zbus::blocking::Connection::session() else {
        return;
    };
    let (name, path) = dbus_name_and_path(dbus_id);
    let cwd = std::env::current_dir().unwrap_or_default();
    let forwarded = connection.call_method(
        Some(name.as_str()),
        path.as_str(),
        Some("org.SingleInstance.DBus"),
        "ExecuteCallback",
        &(
            std::env::args().collect::<Vec<String>>(),
            cwd.to_str().unwrap_or_default(),
        ),
    );
    if forwarded.is_ok() {
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::dbus_name_and_path;

    #[test]
    fn matches_the_single_instance_plugin_naming() {
        assert_eq!(
            dbus_name_and_path("com.bilingify.readest"),
            (
                "com.bilingify.readest.SingleInstance".to_string(),
                "/com/bilingify/readest/SingleInstance".to_string()
            )
        );
    }
}
