---
name: android-cdp-e2e-lane
description: "pnpm test:android — CDP+adb e2e lane driving the installed app on a device/emulator; harness design, gotchas, CI workflow"
metadata: 
  node_type: memory
  type: project
  originSessionId: 16f94822-04b0-4be3-a47e-8a2e3cab290a
  modified: 2026-08-04T05:34:59.609Z
---

New test tier (PR #4545, merged 2026-06-12): `pnpm test:android` → `scripts/test-android.sh` → `vitest.android.config.mts` (node env, serial, retry 1) → `src/__tests__/android/*.android.test.ts`. Helpers in `src/__tests__/android/helpers/`: `adb.ts` (tap/longPress/`motionGesture` = one-shell DOWN/MOVE/UP chain), `cdp.ts` (forward `webview_devtools_remote_<pid>`, node:http discovery with Host header, `CdpPage.evaluate` async-IIFE), `reader.ts` (fixture open + probes). Soft-skips without adb/device/app. Covers the [[android-hyphen-selection-bounds-1553]] cases: prone long-press → app handles, drag repair clamp, tap dismissal, handle-drag extension, mid-paragraph native handles, cross-page corner-dwell auto-turn.

Design principles (per chrox): discover-don't-assume (find a hyphenated on-screen paragraph at runtime, start in main text via `gotoChapter('chapter\\s*4')`), force hyphenation by injecting `p{hyphens:auto!important;text-align:justify!important}` into section docs (app settings irrelevant), poll-don't-sleep (`waitFor`), fixture `sample-alice.epub` opened TRANSIENTLY via MediaStore VIEW intent.

Gotchas:
- MediaStore `_data` is the canonical `/storage/emulated/0/...` path — query `_data LIKE '%/<basename>'`, NOT the `/sdcard/` symlink you pushed to. `content query --projection` takes ONE column or space-separated (not comma). VIEW with `--grant-read-uri-permission` works on a permissionless fresh install.
- Multi-section books: each section is its own iframe — record + restore pagination via the TARGET section's frame x (`c.index === sectionIndex`), not `contents[0]`.
- Corner auto-turn (#1354) zone is the reading area INSET by content margins — a drag point in the bottom margin is ignored by `cornerAt`; aim ~4% inside the text area.
- adb `input motionevent` 5px moves are under touch slop → no pointermove; make post-turn drag movements large.
- Verified green on Xiaomi 13 (physical) AND fresh Pixel_9_Pro AVD (`emulator -avd Pixel_9_Pro`, install the aarch64 dev APK), ~21 s.
- Pull-to-refresh / touch-drag verification: `Input.synthesizeScrollGesture {x, y, yDistance: +260, speed: 350, gestureSourceType: 'touch', preventFling: true}` delivers a real touchstart/touchmove/touchend stream (POSITIVE yDistance = finger travels DOWN = top overscroll); adb `input swipe`/motionevent does NOT reliably deliver touchmove to the page. `CdpPage.send` is TS-private — reach it with a cast through `unknown`. Observe mid-gesture DOM with a page-side rAF recorder pushed into `window.__x`, and write results to a host file via `node:fs` from the spec (vitest swallows console.log); launch to LIBRARY page with `monkey -p PKG -c android.intent.category.LAUNCHER 1`, find the CDP target whose url does NOT include '/reader'.

CI: `.github/workflows/android-e2e.yml` — ubuntu-latest + KVM udev rule, debug x86_64 APK (`tauri android build --debug --target x86_64`; gradle skips keystore.properties when absent so NO signing secrets), `reactivecircus/android-emulator-runner@v2` (api 34, AVD snapshot cached), nightly + workflow_dispatch + `e2e-android` PR label; not PR-blocking. NOTE: emulator-runner not SHA-pinned yet (repo convention pins by SHA).

Live CSS preview on a bundled device build (no rebuild): `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` (find via `cat /proc/net/unix | grep devtools`), then websocket to `/devtools/page/<id>` — Chromium 111+ rejects the handshake with 403 unless you omit the Origin header (`websocket-client` needs `suppress_origin=True`). `Runtime.evaluate` can toggle classes already in the shipped CSS bundle (e.g. `bg-base-300/45` via `classList.add('bg-base-300/45')`) and inline-style anything new (masks etc.), then `adb exec-out screencap` for the after shot. Used for the #search-history translucency fix (library page.tsx chips).
