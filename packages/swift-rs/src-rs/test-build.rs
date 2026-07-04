//! Build script for swift-rs that is a no-op for normal builds, but can be enabled
//! to include test swift library based on env var `TEST_SWIFT_RS=true` with the
//! `build` feature being enabled.

#[cfg(feature = "build")]
mod build;

fn main() {
    println!("cargo:rerun-if-env-changed=TEST_SWIFT_RS");

    #[cfg(feature = "build")]
    if std::env::var("TEST_SWIFT_RS").unwrap_or_else(|_| "false".into()) == "true" {
        use build::SwiftLinker;

        SwiftLinker::new("10.15")
            .with_ios("11")
            .with_package("test-swift", "tests/swift-pkg")
            .link();
    }
}
