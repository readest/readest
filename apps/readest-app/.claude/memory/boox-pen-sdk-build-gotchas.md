---
name: boox-pen-sdk-build-gotchas
description: "Building the opt-in booxPen flavor (Onyx Pen SDK, PR #6674) needs 5 Gradle fixes; Leaf5 has NO pen digitizer"
metadata:
  node_type: memory
  type: project
  originSessionId: cb51df53-15ef-424f-9bd4-07f9f549b5d5
  modified: 2026-10-10T03:28:09.720Z
---

PR #6674 (BOOX handwriting) MERGED 2026-10-11 (7893fa916); worktree removed. See [[handwriting-ink-6674]]. The `booxPen`
flavor links `com.onyx.android.sdk:onyxsdk-pen:1.4.11` from `repo.boox.com`. Build with
`ORG_GRADLE_PROJECT_penFlavor=booxPen pnpm tauri android build -t aarch64`.

Gotchas hit while making it build (all gated on `penFlavor == booxPen`):
1. Repo must be declared in the **app** module too — consumers resolve plugin deps with their own repos.
2. SDK `TouchPoint` lives in `com.onyx.android.sdk.data.note`, not `...pen.data` (javap the cached aar).
3. `libc++_shared.so` duplicated (onyxsdk-pen + mmkv) → `packaging.jniLibs.pickFirsts`.
4. App's custom llvm-strip pass fails on prebuilt `libneo_pen.so` / `libc++.so` → exclude them.
5. `easypermissions` drags `com.android.support` 24.2.1 → duplicate classes; `exclude(group = "com.android.support")`.
6. R8 missing classes (tink/jackson/joda/slf4j) → flavor `consumerProguardFiles("proguard-boox.pro")`.

**Leaf5 (Android 13, 1264x1680, dpr 2.1875) has no EMR pen layer**: only `cyttsp5_mt` capacitive
touch, which still advertises `TOUCHSCREEN | STYLUS`. Raw drawing is gated on a STYLUS device with no
`AXIS_TOUCH_MAJOR` range; Leaf5 correctly reports `rawDrawing:false` and draws via pointer events.
The raw-drawing path itself is still UNVERIFIED on real pen hardware (Note/Tab series).

**How to apply:** reuse these before re-deriving them; test raw drawing only on a pen-capable BOOX.
Device UI is zh-CN — select by structure, not English labels. See [[bug-patterns]].
