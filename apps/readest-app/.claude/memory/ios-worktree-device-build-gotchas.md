---
name: ios-worktree-device-build-gotchas
description: "iOS device build from a worktree - copy ignored gen/apple files; \"Bundle has no member main\" can be stale SwiftPM state in cargo out dirs, not the Xcode 26 swift-rs bug"
metadata:
  node_type: memory
  type: project
  originSessionId: cb51df53-15ef-424f-9bd4-07f9f549b5d5
  modified: 2026-10-11T07:21:17.588Z
---

Hit 2026-10-11 building PR #6674 for the iPad Air M2 (iPadOS 27, Xcode 26.3) from `readest-pr-6674`.

1. `pnpm worktree:new` does not bring the gitignored iOS project files. `tauri ios build` dies with
   `failed to parse plist .../Readest_iOS/Info.plist`. Copy them from the main checkout's
   `src-tauri/gen/apple`: `.gitignore Assets.xcassets ExportOptions.plist LaunchScreen.storyboard Podfile Sources
   Readest.xcodeproj/{project.xcworkspace,xcshareddata} ReadestWidget/Info.plist Readest_iOS/Info.plist`. Leave `build/` and `Externals/` behind.
2. Swift plugin builds failed with the [[xcode26-swiftrs-ios-build-broken]] symptoms (`Bundle has no member 'main'`,
   `CALayer has no member cornerRadius`) EVEN WITH the vendored swift-rs. Not env, not a parallel race: the same
   `swift build` passes in a fresh `--build-path` and fails in cargo's
   `target/aarch64-apple-ios/release/build/<plugin>-<hash>/out/swift-rs/<pkg>`, which holds stale SwiftPM state.
   Fix: `rm -rf target/aarch64-apple-ios/release/{build,.fingerprint}/tauri*` and rebuild. Deleting only `out/swift-rs` is
   wrong: cargo keeps the cached build-script result and the link fails with `could not find native static library`.
3. Install pinned: `ideviceinstaller -u <UDID> install src-tauri/gen/apple/build/arm64/Readest.ipa` (an iPhone is also
   paired; see [[feedback-pin-adb-serial]]). The user's shell exports `iPad`/`iPhone` UDID vars.
4. SILENT stale Swift (2026-10-30, Xcode 27.1 / Swift 6.4): the build SUCCEEDS but the app runs old plugin Swift
   ("No command paper_curl found for plugin native-bridge"; Page Curl and Page Flip both dead on device). Swift 6.4's
   default `--build-system swiftbuild` writes to `out/swift-rs/<pkg>/out/Products/Release-iphoneos/`, while
   packages/swift-rs/src-rs/build.rs linked `<triple>/release/`, where libs from a pre-6.4 build lingered. With that
   dir cleared, every iOS build fails: "could not find native static library `Tauri`". Fix MERGED in #7160:
   build.rs reruns the swift command with `--show-bin-path` and links that dir.
   Check: `nm <lib>.a | grep <new command>`.
