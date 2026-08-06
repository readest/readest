---
name: build-ci-recipes
description: "Aggregator index for stable build, testing, e2e, release, and CI recipe memories"
metadata: 
  node_type: memory
  type: reference
  originSessionId: bd78030b-1892-4a7c-8c99-79084f0310bc
  modified: 2026-08-06T03:23:17.669Z
---

Moved from MEMORY.md to keep the index small. One line per memory; open the linked file for detail.

- [Screenshot baselines unregenerable](vitest-screenshot-baseline-relative-path.md) FIXED #5351
- #4906 nightly sharun hang pre-seed + timeouts
- [#5498 dangling sourceMappingURL comments](tauri-dangling-sourcemap-comments-5498.md) MERGED; KEEP_SOURCEMAPS=1 for dev-ios/android/macos; biome skips .mjs; cargo target = workspace root; `dotenv -v` for script env vars
- Android CDP: [e2e lane](android-cdp-e2e-lane.md); [profiling](cdp-android-webview-profiling.md); [double-tap](android-e2e-doubletap-cdp-gesture.md)
- [Android e2e local repro](android-e2e-local-repro-workflow.md) dev-android vs debug run-as
- [Nightly e2e fix](android-e2e-nightly-fix-5453.md) PR #5453; immersive prompt eats touches (screencap first!)
- [Chrome clipboard paste probe](chrome-clipboard-paste-probe.md) real cmd+V into injected input, never `clipboard.readText()`
- [Settings panel screenshot](settings-panel-screenshot-via-playwright.md) throwaway spec + `openBook`; `.modal-box` -> `.first()`
- [iOS sim drive via dev-server relay](ios-sim-drive-via-dev-server-relay.md)
- [iOS sim build+drive workflow](ios-sim-build-and-drive-workflow.md) take the app from the **xcarchive**
- [Tauri Rust↔JS parser parity](tauri-parser-parity-tests.md)
- [fastlane App Store](fastlane-apple-appstore-submission.md) `APPLE_API_KEY_PATH` out of build env
- [Turbopack cache OOM #4619](turbopack-build-cache-oom-docker-standalone.md) · [pdfjs vendor wasm](pdfjs-vendor-wasm-decoders.md) copy `wasm/*`
- [CF Worker 64 MiB deploy fail](cf-worker-64mb-turbopack-regression.md) split build + stubs
- pnpm version mismatch use `npx pnpm@11.1.1`
- [Xcode 26.2 broke iOS builds](xcode26-swiftrs-ios-build-broken.md) vendored `packages/swift-rs`
- [iOS SPM Sentry proxy hang](ios-spm-sentry-proxy-tls-download.md)
- [tauri 2.11 remote ACL app commands](tauri-211-remote-acl-app-commands.md) webdriver = remote origin
- [Kotlin never compiled in CI](android-kotlin-unit-test-gradle-recipe.md) compile plugin Kotlin locally via gen/android gradlew
