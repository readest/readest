---
name: ios-sim-build-without-matching-runtime
description: "tauri ios build --target aarch64-sim fails 'Xcode Simulator SDK 27.2 is not installed' when no sim runtime matches the SDK; serve xcode-script's options over a local WS and run xcodebuild directly (features must include tauri/custom-protocol, args --lib)"
metadata:
  type: reference
---

On 2026-11-18, Xcode 27.2 had the iOS 27.2 simulator SDK but only the 27.0 and 27.1 runtimes. cargo-mobile2 (inside the tauri CLI) wants a runtime equal to the SDK, so `tauri ios build --target aarch64-sim` dies after the Next build. Downloading the runtime (~8 GB) wasn't an option with 13 GB free.

What worked (#7566):
1. The Xcode "Build Rust Code" phase runs `tauri ios xcode-script`. It reads `$TMPDIR/com.bilingify.readest-server-addr` and calls JSON-RPC `options` over a WebSocket (tauri-cli `mobile/mod.rs` `read_options`). Serve that with a 20-line node `ws` server returning `{dev:false, features:['devtools','tauri/custom-protocol'], args:['--lib'], noise_level:'Polite', vars:{}, config:[], target_device:null}`. Without `tauri/custom-protocol` the app loads devUrl `localhost:3000`.
2. `xcodebuild -workspace Readest.xcodeproj/project.xcworkspace -scheme Readest_iOS -configuration release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' ARCHS=arm64 ONLY_ACTIVE_ARCH=NO -derivedDataPath <scratch> CODE_SIGNING_ALLOWED=NO build`. `-arch` together with a generic destination is rejected. The app runs on the 27.0 runtime.
3. `out/` must already hold the Next export; the failed CLI build leaves it there. The build rewrites quoting in project.pbxproj: `git checkout` it afterwards.

Headless checks without computer use:
- A temporary `CFNotificationCenterAddObserver` hook in the plugin, fired with `xcrun simctl spawn booted notifyutil -p <name>`. Separate literal closures per name, since a ternary between closures can't form a C function pointer.
- iwdp plus a WebKit `Target.sendMessageToTarget` eval script, as in [[ios-sim-webview-drive-via-iwdp]].
- `simctl launch com.apple.Preferences` backgrounds Readest. SIGSTOP the `CoreSimulator.*WebKit.WebContent` pid to stand in for suspension.
- `simctl openurl readest://book/<hash>` didn't open the reader; `location.assign('/reader?ids=<hash>')` via the inspector did.
