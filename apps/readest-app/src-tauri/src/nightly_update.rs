//! Nightly update channel: base-aware version comparator + verify/install
//! commands. The comparator mirrors `src/utils/version.ts::isUpdateNewer` and is
//! validated against the same matrix.

use semver::Version;

/// Returns the 10-digit nightly stamp if the prerelease is exactly `YYYYMMDDHH`.
fn parse_stamp(v: &Version) -> Option<u64> {
    let pre = v.pre.as_str();
    if pre.len() == 10 && pre.bytes().all(|b| b.is_ascii_digit()) {
        pre.parse::<u64>().ok()
    } else {
        None
    }
}

/// Base-aware "is `candidate` newer than `current`?" — see version.ts for the rule.
pub fn is_update_newer(candidate: &str, current: &str) -> bool {
    let (c, cur) = match (Version::parse(candidate), Version::parse(current)) {
        (Ok(c), Ok(cur)) => (c, cur),
        _ => return false,
    };
    let c_base = (c.major, c.minor, c.patch);
    let cur_base = (cur.major, cur.minor, cur.patch);
    if c_base != cur_base {
        return c_base > cur_base;
    }
    match (parse_stamp(&c), parse_stamp(&cur)) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (Some(cs), Some(curs)) => cs > curs,
        (None, None) => false,
    }
}

/// Base64-decode `s` and interpret the bytes as UTF-8, mirroring Tauri's
/// `base64_to_string` (`tauri-plugin-updater-2.10.1/src/updater.rs:1465`).
fn base64_to_string(s: &str) -> Option<String> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD.decode(s).ok()?;
    String::from_utf8(decoded).ok()
}

/// Verify a downloaded artifact against a minisign signature using the embedded
/// updater public key. `pub_key` is the base64 blob from `tauri.conf.json`
/// `updater.pubkey` and `signature` is the base64 contents of the artifact's
/// `.sig` file — the same two inputs Tauri's own updater consumes. This mirrors
/// `verify_signature` (`tauri-plugin-updater-2.10.1/src/updater.rs:1453`) so a
/// nightly artifact accepted here is also accepted by Tauri's installer.
#[tauri::command]
pub async fn verify_update_signature(path: String, signature: String, pub_key: String) -> bool {
    use minisign_verify::{PublicKey, Signature};

    let Some(pub_key_decoded) = base64_to_string(&pub_key) else {
        return false;
    };
    let Ok(public_key) = PublicKey::decode(&pub_key_decoded) else {
        return false;
    };
    let Some(signature_decoded) = base64_to_string(&signature) else {
        return false;
    };
    let Ok(sig) = Signature::decode(&signature_decoded) else {
        return false;
    };
    let Ok(data) = std::fs::read(&path) else {
        return false;
    };
    public_key.verify(&data, &sig, true).is_ok()
}

/// Progress event streamed to the JS install dialog over an IPC `Channel`.
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightlyProgress {
    pub event: String, // "progress" | "finished"
    pub downloaded: u64,
    pub content_length: u64,
}

/// Drives the Tauri updater against a single nightly/stable manifest endpoint
/// with the base-aware [`is_update_newer`] comparator, then downloads, installs
/// and relaunches. Reuses Tauri's minisign verification and native installers
/// (`.app.tar.gz` on macOS, NSIS on Windows). Progress is streamed to the JS
/// dialog over `channel`.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_nightly_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    endpoint: String,
    channel: tauri::ipc::Channel<NightlyProgress>,
) -> std::result::Result<(), String> {
    use tauri::Url;
    use tauri_plugin_updater::UpdaterExt;

    let url = Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .version_comparator(|current, release| {
            is_update_newer(&release.version.to_string(), &current.to_string())
        })
        .build()
        .map_err(|e| e.to_string())?;

    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("no update available".into());
    };

    let mut downloaded: u64 = 0;
    let progress_channel = channel.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_channel.send(NightlyProgress {
                    event: "progress".into(),
                    downloaded,
                    content_length: total.unwrap_or(0),
                });
            },
            move || {
                let _ = channel.send(NightlyProgress {
                    event: "finished".into(),
                    downloaded: 0,
                    content_length: 0,
                });
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart()
}

#[cfg(test)]
mod tests {
    use super::is_update_newer;

    #[test]
    fn matrix() {
        let cases: &[(&str, &str, bool)] = &[
            ("0.11.5", "0.11.4-2026061406", true),
            ("0.11.4-2026061506", "0.11.4-2026061406", true),
            ("0.11.4-2026061406", "0.11.4-2026061506", false),
            ("0.11.4", "0.11.4-2026061406", false),
            ("0.11.4-2026061406", "0.11.4", true),
            ("0.11.5-2026070106", "0.11.4", true),
            ("0.11.4", "0.11.4", false),
            ("0.11.4-2026061406", "0.11.4-2026061406", false),
            ("0.11.4-rc.1", "0.11.4", false),
            ("", "0.11.4", false),
            ("0.11.4", "", false),
        ];
        for (cand, cur, want) in cases {
            assert_eq!(
                is_update_newer(cand, cur),
                *want,
                "is_update_newer({cand}, {cur})"
            );
        }
    }
}
