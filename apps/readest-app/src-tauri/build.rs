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

    propagate_sentry_dsn();
    propagate_app_version();

    tauri_build::build()
}

/// Bake the app version from `package.json` into the crate as `READEST_APP_VERSION`
/// (read back via `option_env!`). Sentry keys its release/environment off this
/// rather than `CARGO_PKG_VERSION`, because the crate version in `Cargo.toml` is
/// not kept in sync with the app version (and only `package.json` carries the
/// nightly `-YYYYMMDDHH` stamp). Absent/unparseable => unset, so the Rust code
/// falls back to the crate version.
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

/// Bake the Sentry DSN into the crate at build time via `cargo:rustc-env`, so
/// `option_env!("SENTRY_DSN")` (and, on iOS, the `readest_sentry_dsn` FFI) sees
/// it. Precedence: an existing `SENTRY_DSN` in the environment (CI secret / shell
/// export) wins; otherwise fall back to the gitignored `.env.local`, then `.env`,
/// at the app root. Absent everywhere => unset, so reporting stays disabled for
/// local and fork builds. `rerun-if-*` makes cargo recompile when the value or
/// the dotenv files change (avoiding a stale baked-in value).
fn propagate_sentry_dsn() {
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    let app_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let env_local = app_dir.join(".env.local");
    let env_file = app_dir.join(".env");
    println!("cargo:rerun-if-changed={}", env_local.display());
    println!("cargo:rerun-if-changed={}", env_file.display());

    let dsn = env::var("SENTRY_DSN")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| read_env_value(&env_local, "SENTRY_DSN"))
        .or_else(|| read_env_value(&env_file, "SENTRY_DSN"));

    if let Some(dsn) = dsn {
        println!("cargo:rustc-env=SENTRY_DSN={dsn}");
    }
}

/// Read a single `KEY=value` from a dotenv-style file, skipping blank lines and
/// `#` comments and stripping surrounding quotes. `None` if the file/key is
/// absent or the value is empty.
fn read_env_value(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line
            .strip_prefix(key)
            .and_then(|rest| rest.trim_start().strip_prefix('='))
        {
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
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
