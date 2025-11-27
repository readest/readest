fn main() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    // Build the thumbnail provider DLL when targeting Windows
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        println!("cargo:rerun-if-changed=src/windows/thumbnail/");

        // Build the DLL crate (in-tree under src/windows/thumbnail)
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
        // The windows thumbnail crate's source files live under `src/windows/thumbnail`.
        // Build it from there to keep everything in one place
        let dll_crate_dir = PathBuf::from(&manifest_dir)
            .join("src")
            .join("windows")
            .join("thumbnail");
        let target_dir = env::var("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                // If CARGO_TARGET_DIR is not set, use the default target directory
                let mut path = PathBuf::from(&manifest_dir);
                path.push("..");
                path.push("..");
                path.push("..");
                path.push("target");
                path
            });

        let profile = if env::var("PROFILE").unwrap_or_default() == "release" {
            "release"
        } else {
            "debug"
        };

        let dll_path = target_dir.join(profile).join("windows_thumbnail.dll");

        // The in-tree crate must exist when targeting Windows; fail otherwise
        let manifest_path = dll_crate_dir.join("Cargo.toml");
        if !dll_crate_dir.exists() || !manifest_path.exists() {
            eprintln!(
                "cargo:error=In-tree thumbnail crate not found at {}; the Windows build requires this crate",
                dll_crate_dir.display()
            );
            std::process::exit(1);
        }

        // Build the DLL using workspace-aware cargo command (mandatory)
        // Build the DLL using workspace-aware cargo command
        let mut cmd = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".to_string()));
        cmd.arg("build")
            .arg("--lib")
            .arg("--package")
            .arg("windows_thumbnail")
            .arg("--manifest-path")
            .arg(dll_crate_dir.join("Cargo.toml"));

        if profile == "release" {
            cmd.arg("--release");
        }

        // If cross-compiling ensure to pass target triple
        if let Ok(target_triple) = env::var("TARGET") {
            let host_triple = env::var("HOST").unwrap_or_default();
            if !target_triple.is_empty() && host_triple != target_triple {
                cmd.arg("--target").arg(target_triple);
            }
        }

        let output = cmd.output();
        match output {
            Ok(output) if output.status.success() => {
                // Copy the DLL from the thumbnail crate's target to the main target
                let thumbnail_dll_path = dll_crate_dir
                    .join("target")
                    .join(profile)
                    .join("windows_thumbnail.dll");
                if thumbnail_dll_path.exists() {
                    if let Some(parent) = dll_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if std::fs::copy(&thumbnail_dll_path, &dll_path).is_ok() {
                        println!("cargo:warning=Successfully built and copied windows_thumbnail.dll to {}", dll_path.display());
                        // Also copy to release if in debug, to satisfy tauri config
                        if profile == "debug" {
                            let release_dll_path =
                                target_dir.join("release").join("windows_thumbnail.dll");
                            if let Some(parent) = release_dll_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            // Only attempt copy if source exists
                            if thumbnail_dll_path.exists() {
                                let _ = std::fs::copy(&thumbnail_dll_path, &release_dll_path);
                            } else {
                                eprintln!(
                                    "cargo:warning=Release copy skipped; source {} does not exist",
                                    thumbnail_dll_path.display()
                                );
                            }
                        }
                    } else {
                        eprintln!(
                            "cargo:warning=Failed to copy DLL from {} to {}",
                            thumbnail_dll_path.display(),
                            dll_path.display()
                        );
                    }
                } else {
                    eprintln!(
                        "cargo:error=DLL build reported success but file not found at {}",
                        thumbnail_dll_path.display()
                    );
                    std::process::exit(1);
                }
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!("cargo:error=Failed to build DLL. stderr: {}", stderr);
                if !stdout.is_empty() {
                    eprintln!("cargo:error=stdout: {}", stdout);
                }
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!("cargo:error=Failed to execute cargo build for DLL: {}", e);
                std::process::exit(1);
            }
        }

        // Watch for DLL changes
        if dll_path.exists() {
            println!("cargo:rerun-if-changed={}", dll_path.display());
        }
    } // end if target_os == "windows"

    // Ensure the bundle resource used for the Windows thumbnail DLL exists
    // When running on non-Windows CI (e.g., Linux), the DLL won't exist; create a placeholder
    // to allow tauri_build to validate resources without failing.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" {
        // The resource is expected in the repository's root target/release path
        if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
            let mut placeholder_path = PathBuf::from(manifest_dir);
            placeholder_path.push("..");
            placeholder_path.push("..");
            placeholder_path.push("..");
            placeholder_path.push("target");
            placeholder_path.push("release");
            placeholder_path.push("windows_thumbnail.dll");

            if let Some(parent) = placeholder_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            if !placeholder_path.exists() {
                // Create an empty placeholder file so tauri's resource checks succeed
                let _ = std::fs::File::create(&placeholder_path);
            }
        }
    }

    tauri_build::build()
}
