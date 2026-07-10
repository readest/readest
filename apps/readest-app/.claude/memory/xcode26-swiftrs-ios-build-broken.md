---
name: xcode26-swiftrs-ios-build-broken
description: Xcode 26.2/Swift 6.2 broke all tauri iOS builds via swift-rs 1.0.7; fixed by vendored packages/swift-rs using --triple/--sdk
metadata: 
  node_type: memory
  type: project
  originSessionId: 603140d5-b247-4f0f-9cdf-0c3479cbcb1e
---

Xcode 26.2 (Swift 6.2.4, 2026-07) broke EVERY `tauri ios build` repo-wide: the Swift plugin packages (native-bridge etc.) fail with phantom errors — `type 'Bundle' has no member 'main'`, `extra argument 'privacy' in call`, `cannot infer contextual base in reference to member 'public'`. Root cause: swift-rs 1.0.7 (unmaintained since 2024, latest release) invokes `swift build --arch <host> -Xswiftc -target <ios-triple>` while inheriting Xcode's `SDKROOT`; Swift 6.2's driver no longer honors that mix, so sources compile against the wrong platform's Swift overlays — overlay-provided APIs (`Bundle.main` sugar, os.Logger privacy interpolation) vanish. Related upstream: tauri-apps/tauri#10717, #11103 ("using sysroot for 'iPhoneOS' but targeting 'MacOSX'").

**Fix (branch feat/page-turn-styles-555):** vendored `packages/swift-rs` + `[patch.crates-io] swift-rs = { path = "packages/swift-rs" }` in root Cargo.toml. Patch in `src-rs/build.rs link()`: use SPM first-class cross-compile flags `--triple <versioned-triple> --sdk <sdk-path>` (drop `--arch` and all `-Xswiftc/-Xcc/-Xcxx` target overrides), `env_remove("SDKROOT")` (leaks from Xcode script phase and breaks SPM's host-targeted MANIFEST compile), and artifact search path becomes `<unversioned-triple>[-simulator]/<config>` (e.g. `arm64-apple-ios/release`) instead of the old hardcoded `<arch>-apple-macosx/<config>`.

**Gotcha exposed by the fix:** with `--triple`, SPM enforces the deployment floor from the package manifest `platforms:` stanza (the old bypass fed the version straight to swiftc). native-bridge's `ios/Package.swift` declared `.iOS(.v14)` while using unguarded iOS-15 API (StoreKit `Storefront`) → bumped to `.iOS("15.0")` (string form — `.v15` needs swift-tools 5.5, manifest is 5.3), matching the app's `IPHONEOS_DEPLOYMENT_TARGET: 15.0` (gen/apple/project.yml).

Fast repro/verify loop (~2 min, no xcodebuild): `SDKROOT=$(xcrun --sdk iphoneos --show-sdk-path) IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build -p tauri-plugin-native-bridge --target aarch64-apple-ios --release` in src-tauri.

Related: [[page-turn-styles-viewtransitions-555]] (branch where this landed), [[deps-security-overrides-workflow]] (vendoring pattern).
