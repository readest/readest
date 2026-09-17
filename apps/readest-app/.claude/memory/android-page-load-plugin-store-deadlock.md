---
name: android-page-load-plugin-store-deadlock
description: "Nightly Android e2e 'timed out waiting for reader page (timeout GET /json/list)' = a REAL app freeze at launch: tauri page-load callback on the main thread vs a plugin command holding the plugin store lock inside run_mobile_plugin; fork PR readest/tauri#3 + readest #6240"
metadata:
  type: project
---

**Status (2026-09-17):** readest/tauri#3 SQUASH-merged as 382ea858b (original b64f5ce75, branch
`fix/android-page-load-deadlock`, same tree), #6240 repointed to 382ea858b; android-e2e PASSED on #6240 (labeled
`e2e-android`), #6240 not merged yet. The fork squash-merges, so bump the readest gitlink to the MERGED
commit after the fork PR lands, never to the PR-branch commit, or it ends up
orphaned (see [[tauri-fork-bump-workspace-exclude-swift-rs]]).

**Symptom:** since mid-Aug roughly every other nightly Android E2E (CDP) run failed in
`openFixtureBook` with `timed out waiting for reader page (last: Error: timeout
GET /json/list)`, on a DIFFERENT test file each night. The first GET after launch
answers (url `/`), then every later connection is accepted and never answered.
Older runs (Aug 19 - Sep 6) also show a `adb shell pidof` variant (process gone);
NOT reproduced, cause unconfirmed.

**Root cause (debuggerd -j on a hung pid):**
- `main`: wry `onPageLoaded` -> `prepare_pending_webview` page-load closure ->
  `app_manager.plugins.lock()` blocks.
- `JavaBridge`: `Webview::on_message` -> `run_plugin_invoke_handler` HOLDS the
  plugin store lock for the whole handler -> tauri-plugin-fs `GlobalScope::from_command`
  -> `PathResolver::parse` -> `run_mobile_plugin` -> posts to the main looper, `recv()`.
- Same window: path plugin `resolve_directory` is a SYNC command (appDataDir etc.,
  dozens of calls at startup). Upstream tauri `dev` has identical code; no upstream issue.
- Fix: `try_lock` in the page-load closure; on WouldBlock run plugin `on_page_load`
  hooks on a spawned thread. `on_navigation` has the same shape but needs a sync bool,
  left as is (no plugin registers either hook). Unit test
  `page_load_does_not_wait_for_a_busy_plugin_store` in `manager/webview.rs`.

**Why:** the harness looked flaky but the app itself freezes forever; users can hit it.

**How to apply / repro recipe:**
- CI-like AVD: `system-images;android-34;google_apis;arm64-v8a`, `hw.cpu.ncore=2`,
  `hw.ramSize=2560M`, 320x640. Boot with proxy env UNSET (`env -u http_proxy ...`)
  and `-gpu host`; swiftshader + proxy hung the QEMU vCPU threads on this Mac.
- Cold-start loop: force-stop, `am start` VIEW, poll `/json/list` with a 4s
  timeout, `adb root` + `debuggerd -j <pid>` on 2 misses. Old build: 1 freeze in 9
  launches; fixed build: 0 in 40.
- `adb root` makes `am start --grant-read-uri-permission` grant from uid 0 and
  MediaStore content URIs then fail ("path does not have a basename") — `adb unroot`
  before running the real lane.
- Local runs that get killed leave app state behind (top-band test then sees a header
  button over the first line); `pm clear com.bilingify.readest` to match CI's fresh install.
- `double-click.android.test.ts` fails on the local arm64 emulator before AND after
  the fix; passes on CI x86_64. Not investigated.
