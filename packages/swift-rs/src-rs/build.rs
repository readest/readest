#![allow(dead_code)]
use std::{env, fmt::Display, path::Path, path::PathBuf, process::Command};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwiftTarget {
    triple: String,
    unversioned_triple: String,
    module_triple: String,
    //pub swift_runtime_compatibility_version: String,
    #[serde(rename = "librariesRequireRPath")]
    libraries_require_rpath: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwiftPaths {
    runtime_library_paths: Vec<String>,
    runtime_library_import_paths: Vec<String>,
    runtime_resource_path: String,
}

#[derive(Deserialize)]
struct SwiftEnv {
    target: SwiftTarget,
    paths: SwiftPaths,
}

impl SwiftEnv {
    fn new(minimum_macos_version: &str, minimum_ios_version: Option<&str>) -> Self {
        let rust_target = RustTarget::from_env();
        let target = rust_target.swift_target_triple(minimum_macos_version, minimum_ios_version);

        let swift_target_info_str = Command::new("swift")
            .args(["-target", &target, "-print-target-info"])
            .output()
            .unwrap()
            .stdout;

        serde_json::from_slice(&swift_target_info_str).unwrap()
    }
}

#[allow(clippy::upper_case_acronyms)]
enum RustTargetOS {
    MacOS,
    IOS,
}

impl RustTargetOS {
    fn from_env() -> Self {
        match env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
            "macos" => RustTargetOS::MacOS,
            "ios" => RustTargetOS::IOS,
            _ => panic!("unexpected target operating system"),
        }
    }

    fn to_swift(&self) -> &'static str {
        match self {
            Self::MacOS => "macosx",
            Self::IOS => "ios",
        }
    }
}

impl Display for RustTargetOS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MacOS => write!(f, "macos"),
            Self::IOS => write!(f, "ios"),
        }
    }
}

#[allow(clippy::upper_case_acronyms)]
enum SwiftSDK {
    MacOS,
    IOS,
    IOSSimulator,
}

impl SwiftSDK {
    fn from_os(os: &RustTargetOS) -> Self {
        let target = env::var("TARGET").unwrap();
        let simulator = target.ends_with("ios-sim")
            || (target.starts_with("x86_64") && target.ends_with("ios"));

        match os {
            RustTargetOS::MacOS => Self::MacOS,
            RustTargetOS::IOS if simulator => Self::IOSSimulator,
            RustTargetOS::IOS => Self::IOS,
        }
    }

    fn clang_lib_extension(&self) -> &'static str {
        match self {
            Self::MacOS => "osx",
            Self::IOS => "ios",
            Self::IOSSimulator => "iossim",
        }
    }
}

impl Display for SwiftSDK {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MacOS => write!(f, "macosx"),
            Self::IOSSimulator => write!(f, "iphonesimulator"),
            Self::IOS => write!(f, "iphoneos"),
        }
    }
}

struct RustTarget {
    arch: String,
    os: RustTargetOS,
    sdk: SwiftSDK,
}

impl RustTarget {
    fn from_env() -> Self {
        let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let os = RustTargetOS::from_env();
        let sdk = SwiftSDK::from_os(&os);

        Self { arch, os, sdk }
    }

    fn swift_target_triple(
        &self,
        minimum_macos_version: &str,
        minimum_ios_version: Option<&str>,
    ) -> String {
        let unversioned = self.unversioned_swift_target_triple();
        format!(
            "{unversioned}{}{}",
            match (&self.os, minimum_ios_version) {
                (RustTargetOS::MacOS, _) => minimum_macos_version,
                (RustTargetOS::IOS, Some(version)) => version,
                _ => "",
            },
            // simulator suffix
            matches!(self.sdk, SwiftSDK::IOSSimulator)
                .then(|| "-simulator".to_string())
                .unwrap_or_default()
        )
    }

    fn unversioned_swift_target_triple(&self) -> String {
        format!(
            "{}-apple-{}",
            match self.arch.as_str() {
                "aarch64" => "arm64",
                a => a,
            },
            self.os.to_swift(),
        )
    }
}

struct SwiftPackage {
    name: String,
    path: PathBuf,
}

/// Builder for linking the Swift runtime and custom packages.
#[cfg(feature = "build")]
pub struct SwiftLinker {
    packages: Vec<SwiftPackage>,
    macos_min_version: String,
    ios_min_version: Option<String>,
}

impl SwiftLinker {
    /// Creates a new [`SwiftLinker`] with a minimum macOS verison.
    ///
    /// Minimum macOS version must be at least 10.13.
    pub fn new(macos_min_version: &str) -> Self {
        Self {
            packages: vec![],
            macos_min_version: macos_min_version.to_string(),
            ios_min_version: None,
        }
    }

    /// Instructs the [`SwiftLinker`] to also compile for iOS
    /// using the specified minimum iOS version.
    ///
    /// Minimum iOS version must be at least 11.
    pub fn with_ios(mut self, min_version: &str) -> Self {
        self.ios_min_version = Some(min_version.to_string());
        self
    }

    /// Adds a package to be linked against.
    /// `name` should match the `name` field in your `Package.swift`,
    /// and `path` should point to the root of your Swift package relative
    /// to your crate's root.
    pub fn with_package(mut self, name: &str, path: impl AsRef<Path>) -> Self {
        self.packages.extend([SwiftPackage {
            name: name.to_string(),
            path: path.as_ref().into(),
        }]);

        self
    }

    /// Links the Swift runtime, then builds and links the provided packages.
    /// This does not (yet) automatically rebuild your Swift files when they are modified,
    /// you'll need to modify/save your `build.rs` file for that.
    pub fn link(self) {
        let swift_env = SwiftEnv::new(&self.macos_min_version, self.ios_min_version.as_deref());

        #[allow(clippy::uninlined_format_args)]
        for path in swift_env.paths.runtime_library_paths {
            println!("cargo:rustc-link-search=native={path}");
        }

        let debug = env::var("DEBUG").unwrap() == "true";
        let configuration = if debug { "debug" } else { "release" };
        let rust_target = RustTarget::from_env();

        link_clang_rt(&rust_target);

        for package in self.packages {
            let package_path =
                Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join(&package.path);
            let out_path = Path::new(&env::var("OUT_DIR").unwrap())
                .join("swift-rs")
                .join(&package.name);

            let sdk_path_output = Command::new("xcrun")
                .args(["--sdk", &rust_target.sdk.to_string(), "--show-sdk-path"])
                .output()
                .unwrap();
            if !sdk_path_output.status.success() {
                panic!(
                    "Failed to get SDK path with `xcrun --sdk {} --show-sdk-path`",
                    rust_target.sdk
                );
            }

            let sdk_path = String::from_utf8_lossy(&sdk_path_output.stdout);

            let mut command = Command::new("swift");
            command.current_dir(&package.path);

            let swift_target_triple = rust_target
                .swift_target_triple(&self.macos_min_version, self.ios_min_version.as_deref());

            // READEST PATCH (Xcode 26.2 / Swift 6.2): the upstream invocation
            // built with `--arch <host>` and overrode the target per-swiftc via
            // `-Xswiftc -target`. Swift 6.2's driver no longer honors that mix:
            // sources compile against the wrong platform's Swift overlays, so
            // overlay-provided APIs (`Bundle.main`, os.Logger's `privacy:`
            // interpolation) vanish with baffling errors. Use SPM's first-class
            // cross-compilation flags instead: `--triple` + `--sdk`.
            command
                // Build the package (duh)
                .arg("build")
                // Cross-compile for the target platform; SPM forwards the
                // triple to swiftc and clang itself.
                .args(["--triple", &swift_target_triple])
                // SDK for the target platform.
                .args(["--sdk", sdk_path.trim()])
                // Release/Debug configuration
                .args(["-c", configuration])
                // Where the artifacts will be generated to
                .args(["--build-path", &out_path.display().to_string()]);

            // Xcode's script phases export SDKROOT for the *product* platform
            // (e.g. iphoneos), which leaks into SPM's manifest compilation —
            // the manifest must always build for the host — and breaks it with
            // "using sysroot for 'iPhoneOS' but targeting 'MacOSX'". The
            // explicit `--sdk` above covers the target sources.
            command.env_remove("SDKROOT");

            if !command.status().unwrap().success() {
                panic!("Failed to compile swift package {}", package.name);
            }

            // With `--triple`, swift build writes artifacts into a directory
            // named after the unversioned triple (plus the simulator suffix),
            // e.g. `arm64-apple-ios/release` or `arm64-apple-ios-simulator/release`.
            let triple_dir = format!(
                "{}{}",
                rust_target.unversioned_swift_target_triple(),
                matches!(rust_target.sdk, SwiftSDK::IOSSimulator)
                    .then(|| "-simulator".to_string())
                    .unwrap_or_default()
            );
            let search_path = out_path.join(triple_dir).join(configuration);

            println!("cargo:rerun-if-changed={}", package_path.display());
            println!("cargo:rustc-link-search=native={}", search_path.display());
            println!("cargo:rustc-link-lib=static={}", package.name);
        }
    }
}

fn link_clang_rt(rust_target: &RustTarget) {
    println!(
        "cargo:rustc-link-lib=clang_rt.{}",
        rust_target.sdk.clang_lib_extension()
    );
    println!("cargo:rustc-link-search={}", clang_link_search_path());
}

fn clang_link_search_path() -> String {
    let output = std::process::Command::new(
        std::env::var("SWIFT_RS_CLANG").unwrap_or_else(|_| "/usr/bin/clang".to_string()),
    )
    .arg("--print-search-dirs")
    .output()
    .unwrap();
    if !output.status.success() {
        panic!("Can't get search paths from clang");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("libraries: =") {
            let path = line.split('=').nth(1).unwrap();
            return format!("{}/lib/darwin", path);
        }
    }
    panic!("clang is missing search paths");
}
