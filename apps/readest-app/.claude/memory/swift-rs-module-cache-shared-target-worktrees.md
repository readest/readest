---
name: swift-rs-module-cache-shared-target-worktrees
description: "iOS/macOS Swift package build dies with 'PCH was compiled with module cache path X, but the path is currently Y' + 'missing required module SwiftShims' after a worktree is removed; root = target symlink shared by every worktree, clang bakes the path spelling into the module cache; chrox chose the manual ModuleCache clear over patching vendored swift-rs; patch DISCARDED 2026-09-19"
metadata:
  type: project
---

**Symptom (2026-09-19, and earlier per shell history 2026-03 + 2026-07):** `tauri ios build` fails in
the plugin build scripts (`packages/swift-rs/src-rs/build.rs:282` panic "Failed to compile swift
package tauri-plugin-biometric" / native-bridge / native-tts) with
`PCH was compiled with module cache path '/Users/chrox/dev/readest-<worktree>/target/...ModuleCache/ROTMNNV740U4', but the path is currently '/Users/chrox/dev/readest/target/...'`
then `missing required module 'SwiftShims'`.

**Root cause:** `/Users/chrox/dev/readest/target` is a symlink to
`/Volumes/ExternalSSD/dev-cache/readest/target`, and `scripts/worktree-new.ts` symlinks every
worktree's `target` to it. Cargo spells OUT_DIR through the checkout, and cargo's metadata hash is
stable across worktrees (relative to the workspace root), so registry AND in-tree plugins share ONE
OUT_DIR from every worktree. SwiftPM passes `-module-cache-path <OUT_DIR>/.../ModuleCache` verbatim;
clang records that string in every `.pcm` and hard-fails (ConfigurationMismatch is NOT rebuildable for
implicit modules) when the same physical cache is reopened under another spelling. Removing the
worktree that last built leaves the cache poisoned for main. Three removed worktrees had poisoned
caches (ipados27-selection-6226 for iOS release; ios-last-page-turn + in-app-browser-5775 for sim/debug).

**Proposed fix, DISCARDED at chrox's request 2026-09-19 (they cleared the cache by hand and preferred not to patch vendored swift-rs; do not re-propose unless it recurs and they ask). It was (packages/swift-rs/src-rs/build.rs, unit-tested; VERIFIED 2026-09-19: a `cargo build -p Readest --target aarch64-apple-ios --release` on main re-ran every plugin build script, all 14 iOS-release module caches recorded under the old spelling were wiped + rebuilt canonical, no PCH error; NOTE a bare-shell cargo run (no SDKROOT/IPHONEOS_DEPLOYMENT_TARGET=16.4) makes cc-rs recompile zstd-sys/ring/simsimd and turso_sdk_kit then fails to link with undefined HUF_* zstd symbols, so export both like Xcode does (with them exported the same command finished the whole lib: exit 0, 3m09s)):**
- `swift_build_path()` canonicalizes OUT_DIR, so every worktree hands SwiftPM `/Volumes/ExternalSSD/...`.
- `module_cache_moved()` reads the SwiftPM `<config>.yaml` manifest (rewritten every build); if it
  recorded a different `-module-cache-path`, `link()` deletes `ModuleCache` before `swift build`.
- `[workspace]` added to `packages/swift-rs/Cargo.toml` so
  `cargo test --manifest-path packages/swift-rs/Cargo.toml --features build --lib` runs.
- CI unaffected (no symlink = canonicalize is a no-op; no manifest = no heal).

**Residual:** worktrees on branches WITHOUT the patch still write their own spelling into the shared
cache; the next patched build self-heals (one Swift rebuild), but the unpatched worktree itself will
hard-fail when it comes back. Rebase long-lived worktrees onto the fix.

**Accepted fix = manual recipe:**
`rm -rf target/<triple>/<profile>/build/*/out/swift-rs/*/<swift-triple>/<config>/ModuleCache`.
Never wipe while `xcodebuild`/`cargo build` is in flight (check `pgrep -fl xcodebuild`).

Related: [[tauri-fork-bump-workspace-exclude-swift-rs]] (why swift-rs is vendored + relabelled 1.0.8),
[[build-ci-recipes]].
