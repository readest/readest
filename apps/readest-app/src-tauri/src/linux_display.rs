use std::ffi::OsStr;

pub fn check_display(display: Option<&OsStr>) -> Result<(), &'static str> {
    if display.is_some_and(|value| !value.is_empty()) {
        return Ok(());
    }

    Err("Readest's Linux CEF runtime requires an X11 display, but DISPLAY is unset or empty. \
         On Wayland, enable XWayland; on Niri, install xwayland-satellite and restart your session. \
         Launch Readest from that session so it inherits DISPLAY. \
         Flatpak also needs access to the X11 socket. \
         See https://github.com/readest/readest#linux-fails-to-launch-on-wayland--niri")
}

#[cfg(test)]
mod tests {
    use super::check_display;
    use std::ffi::OsStr;

    #[test]
    fn missing_display_explains_how_to_run_on_wayland() {
        let error = check_display(None).unwrap_err();
        assert!(error.contains("DISPLAY"));
        assert!(error.contains("XWayland"));
        assert!(error.contains("xwayland-satellite"));
    }

    #[test]
    fn empty_display_is_also_rejected() {
        assert!(check_display(Some(OsStr::new(""))).is_err());
    }

    #[test]
    fn configured_display_is_left_to_the_runtime() {
        for display in [":0", ":1.0", "localhost:10.0"] {
            assert!(check_display(Some(OsStr::new(display))).is_ok());
        }
    }
}
