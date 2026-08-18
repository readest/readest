---
name: build-ci-recipes
description: "Aggregator index for stable build, testing, e2e, release, and CI recipe memories"
metadata: 
  node_type: memory
  type: reference
  originSessionId: bd78030b-1892-4a7c-8c99-79084f0310bc
  modified: 2026-08-16T09:37:05.254Z
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
- [pre-push hook runs the FULL suite](git-push-prepush-hook-runs-full-suite.md) push takes ~8min; `git push | tail` masks failure as exit 0; hook run flakes under load
- [Xcode 26.2 broke iOS builds](xcode26-swiftrs-ios-build-broken.md) vendored `packages/swift-rs`
- [iOS SPM Sentry proxy hang](ios-spm-sentry-proxy-tls-download.md)
- [tauri 2.11 remote ACL app commands](tauri-211-remote-acl-app-commands.md) webdriver = remote origin
- [Kotlin never compiled in CI](android-kotlin-unit-test-gradle-recipe.md) compile plugin Kotlin locally via gen/android gradlew
- [#5550 docker never applied migrations](docker-selfhost-migrations-never-applied-5550.md) MERGED #5551; dir mount shadows core schema
- [PR #5605 nix packaging review](nix-packaging-pr-5605.md) 2 blockers posted; readest ALREADY in nixpkgs — cachix = CI-only
- test-tauri.sh webdriver bogus timeout MERGED #5644: WEBDRIVER_TIMEOUT=900 + build_tauri_app gated on tauri paths
- [Kindle SSH deploy+debug recipe](kindle-ssh-deploy-debug-recipe.md) 192.168.2.180:2222 blank-pw askpass; crash.log silent for sync
- [Turbopack dev stale chunk phantom](turbopack-dev-stale-chunk-phantom.md) rm -rf .next first · [Concurrent sessions share .next/out](concurrent-sessions-share-next-out-dir.md) check `ps` first
- [format:check gate](verify-format-check-gate.md) · [Worktree rebase submodule drift](worktree-rebase-submodule-drift.md) · [Worktree submodule origin = local gitdir](worktree-submodule-origin-is-local-gitdir.md) use FETCH_HEAD
- [worktree:rm deinits the SHARED .git/config](worktree-rm-deinits-shared-git-config.md) check `git submodule status` after rm; `git submodule init` restores (checkouts survive)
- [Shared-target stale plugin cache](worktree-shared-target-stale-plugin-cache.md) cargo clean -p only · [Web e2e local flake](web-e2e-local-devserver-cold-compile-flake.md) cold compile, NOT your change
- [Chrome verify recipe](browser-verify-readest-web-recipe.md) · [CI/PR delivery + push keepalive](ci-pr-delivery-and-push.md) fork pushes need SSH
- [Next page-export check webpack-only](nextjs-page-export-webpack-only-check.md) MERGED #5336; `rm -rf .next` if lint trips
