use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    println!("cargo:rerun-if-changed=../extensions/windows-thumbnail/src");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        build_windows_thumbnail();
    }

    propagate_app_version();

    // Declare the app's own (non-plugin) commands in the ACL app manifest.
    // Since tauri 2.11, IPC from remote origins is always subject to ACL
    // resolution (upstream #15266); without a manifest the app commands have
    // no ACL entries at all and remote pages get "not allowed. Plugin not
    // found". The webdriver test harness serves the vitest tester page from
    // its own port, which is a remote origin, so it needs these permissions
    // granted via capabilities (see capabilities/webdriver-remote.json).
    // With a manifest defined, LOCAL windows also resolve app commands
    // through the ACL, so capabilities/default.json must grant them too.
    // Keep this list in sync with the generate_handler! list in lib.rs.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_server",
            "download_file",
            "upload_file",
            "get_environment_variable",
            "get_executable_dir",
            "set_webview_info",
            "get_webview_version",
            "is_updater_disabled",
            "allow_paths_in_scopes",
            "optimize_cover_thumbnails",
            "read_dir",
            "write_backup_zip",
            "extract_backup_zip",
            "parse_epub_metadata",
            "extract_epub_cover_full",
            "parse_epub_full",
            "get_comic_page_sizes",
            "parse_mobi_metadata",
            "extract_mobi_cover_full",
            "parse_pdf_metadata",
            "render_pdf_cover",
            "auth_with_safari",
            "start_apple_sign_in",
            "set_traffic_lights",
            "set_window_title",
            "show_lookup_popover",
            "update_book_presence",
            "clear_book_presence",
            "clip_url",
            "open_web_browser",
            "fetch_web_browser_resource",
            "get_media_proxy_base",
            "set_web_browser_status",
            "extract_web_browser_archive",
            "spawn_fresh_browser",
            "verify_update_signature",
            "install_nightly_update",
            "localsend_start",
            "localsend_stop",
            "localsend_get_status",
            "localsend_list_devices",
            "localsend_announce",
            "localsend_set_discoverable",
            "localsend_is_alive",
            "localsend_respond",
            "localsend_cancel_receive",
            "localsend_send_files",
            "localsend_cancel_send",
        ]),
    ))
    .expect("failed to run tauri-build");
}

/// Bake the app version from `package.json` into the crate as `READEST_APP_VERSION`
/// (read back via `option_env!`) rather than `CARGO_PKG_VERSION`, because the
/// crate version in `Cargo.toml` is not kept in sync with the app version (and
/// only `package.json` carries the nightly `-YYYYMMDDHH` stamp).
/// Absent/unparseable => unset, so the Rust code falls back to the crate version.
fn propagate_app_version() {
    let package_json = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("package.json");
    println!("cargo:rerun-if-changed={}", package_json.display());

    if let Some(version) = read_json_string_field(&package_json, "version") {
        println!("cargo:rustc-env=READEST_APP_VERSION={version}");
    }
}

/// Read a top-level `"key": "value"` string from a JSON file without pulling in a
/// JSON parser. Returns the first match; `None` if the file/key is absent or the
/// value is empty. `package.json`'s own `"version"` is the first `"version"` key.
fn build_windows_thumbnail() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dll_crate_dir = manifest_dir
        .join("..")
        .join("extensions")
        .join("windows-thumbnail");
    let dll_crate_manifest = dll_crate_dir.join("Cargo.toml");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());

    let mut cmd = Command::new(env::var("CARGO").unwrap_or("cargo".into()));
    cmd.arg("build")
        .arg("--manifest-path")
        .arg(&dll_crate_manifest);

    if profile == "release" {
        cmd.arg("--release");
    }

    let status = cmd
        .status()
        .expect("Failed to run cargo build for windows_thumbnail");
    if !status.success() {
        panic!("Failed to build windows_thumbnail DLL");
    }

    let dll_name = "windows_thumbnail.dll";
    let candidate_paths = [
        dll_crate_dir.join("target").join(&profile).join(dll_name),
        dll_crate_dir
            .join("target")
            .join(&profile)
            .join(dll_name),
    ];

    let dll_src = candidate_paths
        .iter()
        .find(|p| p.exists())
        .expect("Failed to find built windows_thumbnail DLL");

    let dll_dest = &dll_crate_dir.join("target").join(dll_name);

    fs::copy(dll_src, dll_dest).expect("Failed to copy windows_thumbnail DLL");
    println!("cargo:rerun-if-changed={}", dll_dest.display());
}

fn read_json_string_field(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    let needle = format!("\"{key}\"");
    for line in contents.lines() {
        let Some(rest) = line.trim_start().strip_prefix(&needle) else {
            continue;
        };
        let value = rest
            .trim_start()
            .strip_prefix(':')?
            .trim()
            .trim_end_matches(',')
            .trim()
            .trim_matches('"');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn build_windows_thumbnail() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dll_crate_dir = manifest_dir
        .join("..")
        .join("extensions")
        .join("windows-thumbnail");
    let dll_crate_manifest = dll_crate_dir.join("Cargo.toml");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());

    let mut cmd = Command::new(env::var("CARGO").unwrap_or("cargo".into()));
    cmd.arg("build")
        .arg("--package")
        .arg("windows_thumbnail")
        .arg("--manifest-path")
        .arg(&dll_crate_manifest);

    if profile == "release" {
        cmd.arg("--release");
    }

    let target_triple = env::var("TARGET").unwrap_or_default();
    let host_triple = env::var("HOST").unwrap_or_default();
    if !target_triple.is_empty() && target_triple != host_triple {
        cmd.arg("--target").arg(&target_triple);
    }

    let status = cmd
        .status()
        .expect("Failed to run cargo build for windows_thumbnail");
    if !status.success() {
        panic!("Failed to build windows_thumbnail DLL");
    }

    let dll_name = "windows_thumbnail.dll";
    let candidate_paths = [
        dll_crate_dir.join("target").join(&profile).join(dll_name),
        dll_crate_dir
            .join("target")
            .join(&target_triple)
            .join(&profile)
            .join(dll_name),
    ];

    let dll_src = candidate_paths
        .iter()
        .find(|p| p.exists())
        .expect("Failed to find built windows_thumbnail DLL");

    let dll_dest = &dll_crate_dir.join("target").join(dll_name);

    fs::copy(dll_src, dll_dest).expect("Failed to copy windows_thumbnail DLL");
    println!("cargo:rerun-if-changed={}", dll_dest.display());
}
