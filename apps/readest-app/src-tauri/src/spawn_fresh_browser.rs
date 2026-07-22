//! Open a URL in a freshly-spawned, isolated browser process.
//!
//! Why this exists: Windows snapshots URL-protocol associations per browser
//! process at launch. A browser already running before the app registered its
//! reverse-DNS OAuth scheme (`app.deep_link().register_all()`) therefore reports
//! the scheme as having no registered handler and silently drops the redirect.
//! Launching a NEW browser process with its OWN `--user-data-dir` forces a cold
//! association read, so the just-registered scheme routes the redirect back to
//! the app. This is the fallback the desktop OAuth runner uses when the user's
//! default browser does not return within the grace period — see
//! `services/sync/providers/gdrive/auth/oauthDesktop.ts`.
//!
//! We spawn the user's OWN default browser when it is Chromium-based (a familiar
//! window, far less alarming than a surprise foreign browser), falling back to
//! Microsoft Edge only when the default is not Chromium-based — Edge ships on
//! every Windows 10/11 install and routes custom schemes reliably. Forcing an
//! isolated cold process requires the Chromium `--user-data-dir` flag, hence the
//! family check. A stable per-user profile directory is reused so a returning
//! user keeps their Google session across reconnects, and is isolated from the
//! user's real profile so spawning it never disturbs their open browser.
//!
//! Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
//! used with the author's explicit permission.

#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};

/// Subdirectory (under the system temp dir) for the fallback browser's isolated
/// profile.
#[cfg(target_os = "windows")]
const FALLBACK_PROFILE_DIR: &str = "readest-oauth-browser";

/// Executable stems (lower-cased, no extension) of Chromium-based browsers, which
/// all accept `--user-data-dir` to spawn an isolated cold process.
#[cfg(target_os = "windows")]
const CHROMIUM_BROWSER_STEMS: [&str; 7] = [
    "chrome", "chromium", "msedge", "brave", "vivaldi", "opera", "thorium",
];

/// Resolve the user's default `https` browser executable from its per-user
/// UserChoice association (`ProgId` -> `shell\open\command`). Returns `None` if
/// the association is missing/unreadable or the resolved path does not exist.
#[cfg(target_os = "windows")]
fn resolve_default_browser() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
    use winreg::RegKey;

    const USER_CHOICE_KEY: &str =
        r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice";

    let prog_id: String = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(USER_CHOICE_KEY)
        .ok()?
        .get_value("ProgId")
        .ok()?;
    let command: String = RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(format!(r"{prog_id}\shell\open\command"))
        .ok()?
        .get_value("")
        .ok()?;
    let exe = exe_path_from_command(&command)?;
    exe.exists().then_some(exe)
}

/// Extract the executable path from a `shell\open\command` string. Handles the
/// usual quoted form (`"C:\...\app.exe" --flags %1`) and a best-effort unquoted
/// form (up to the first space). Pure (no filesystem access) so it is unit-tested.
#[cfg(target_os = "windows")]
fn exe_path_from_command(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim_start();
    let exe = match trimmed.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => trimmed.split_whitespace().next()?,
    };
    (!exe.is_empty()).then(|| PathBuf::from(exe))
}

/// Whether the executable is a Chromium-based browser (so it accepts
/// `--user-data-dir`). Matched on the lower-cased file stem.
#[cfg(target_os = "windows")]
fn is_chromium_family(exe: &Path) -> bool {
    exe.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| {
            let lowered = stem.to_ascii_lowercase();
            CHROMIUM_BROWSER_STEMS.contains(&lowered.as_str())
        })
        .unwrap_or(false)
}

/// Resolve Microsoft Edge's executable from the standard install locations,
/// honouring a non-default `Program Files` drive via the environment. Probes the
/// 32-bit root first (Edge's historical home), then both 64-bit roots
/// (`ProgramW6432` resolves the real 64-bit path even from a 32-bit process).
#[cfg(target_os = "windows")]
fn find_edge() -> Option<PathBuf> {
    const EDGE_SUFFIX: &str = r"Microsoft\Edge\Application\msedge.exe";
    ["ProgramFiles(x86)", "ProgramW6432", "ProgramFiles"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .map(|base| PathBuf::from(base).join(EDGE_SUFFIX))
        .find(|path| path.exists())
}

/// Open `url` in a freshly-spawned, isolated (cold) browser process so it routes
/// the reverse-DNS OAuth redirect back to the app. Prefers the user's own default
/// browser when it is Chromium-based; otherwise uses Edge. See the module docs
/// for why a cold process is required.
#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub async fn spawn_fresh_browser(url: String) -> Result<(), String> {
    use std::process::Command;

    let browser = resolve_default_browser()
        .filter(|exe| is_chromium_family(exe))
        .or_else(find_edge)
        .ok_or_else(|| "No Chromium-based browser found to open the sign-in window".to_string())?;
    let profile_dir = std::env::temp_dir().join(FALLBACK_PROFILE_DIR);

    Command::new(browser)
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--new-window")
        .arg(url)
        .spawn()
        .map_err(|e| format!("Could not open the sign-in browser: {}", e))?;
    Ok(())
}

/// Non-Windows desktop targets are a no-op success: the per-process association
/// cache that defeats the default browser is a Windows-specific behaviour, so the
/// default-browser open already covered the redirect path there.
#[cfg(all(desktop, not(target_os = "windows")))]
#[tauri::command]
pub async fn spawn_fresh_browser(_url: String) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn extracts_quoted_exe_ignoring_trailing_args() {
        let command = r#""C:\Users\me\AppData\Local\Chromium\Application\chrome.exe" --foo --single-argument %1"#;
        assert_eq!(
            exe_path_from_command(command),
            Some(PathBuf::from(
                r"C:\Users\me\AppData\Local\Chromium\Application\chrome.exe"
            )),
        );
    }

    #[test]
    fn extracts_unquoted_exe_up_to_first_space() {
        assert_eq!(
            exe_path_from_command(r"C:\Apps\browser.exe %1"),
            Some(PathBuf::from(r"C:\Apps\browser.exe")),
        );
    }

    #[test]
    fn returns_none_for_empty_command() {
        assert_eq!(exe_path_from_command("   "), None);
        assert_eq!(exe_path_from_command(r#""""#), None);
    }

    #[test]
    fn recognises_chromium_browsers_by_stem() {
        for exe in [r"C:\x\chrome.exe", r"C:\x\msedge.exe", r"C:\x\Brave.exe"] {
            assert!(
                is_chromium_family(Path::new(exe)),
                "{exe} should be Chromium-family"
            );
        }
    }

    #[test]
    fn rejects_non_chromium_browsers() {
        assert!(!is_chromium_family(Path::new(r"C:\x\firefox.exe")));
        assert!(!is_chromium_family(Path::new(r"C:\x\iexplore.exe")));
    }
}
