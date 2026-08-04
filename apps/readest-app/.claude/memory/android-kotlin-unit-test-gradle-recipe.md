---
name: android-kotlin-unit-test-gradle-recipe
description: CI never compiles plugin Kotlin (PR checks have no Android job) — compile locally via gen/android gradlew; recipe for the missing generated files
metadata: 
  node_type: memory
  type: project
  originSessionId: 9514654c-db01-441e-b22c-ec393f217bb0
  modified: 2026-08-04T04:36:57.782Z
---

**Nothing in PR checks compiles Kotlin.** `build_tauri_app` is desktop-only; `android-e2e.yml` runs nightly or behind the `e2e-android` label. PR #5479 shipped Kotlin that didn't parse and CI stayed green. **Any PR touching `src-tauri/plugins/*/android/` Kotlin must be compiled locally before approving.**

**Why:** Kotlin compile/test errors land on main unnoticed and only surface in the nightly Android lane.

**How to apply — run plugin unit tests in a worktree:**
1. `pnpm worktree:new` runs `tauri android init`, but init does NOT generate `gen/android/tauri.settings.gradle` or `gen/android/app/tauri.build.gradle.kts` (only `tauri android build/dev` does). Copy both from the main worktree (`/Users/chrox/dev/readest/apps/readest-app/src-tauri/gen/android/`), rewriting paths: `sed 's|/dev/readest/|/dev/readest-<wt>/|g' tauri.settings.gradle`; also copy `local.properties`.
2. `cd gen/android && ./gradlew :tauri-plugin-native-bridge:testFossDebugUnitTest :tauri-plugin-native-tts:testDebugUnitTest` (native-bridge has foss/googleplay flavors; native-tts has none).
3. junit is already wired (`testImplementation junit:4.13.2` in plugin build.gradle.kts).

Notes: the copied `tauri.settings.gradle` references cargo-registry plugin paths, so this only works on a machine with the registry populated. A standalone harness (own settings.gradle including just `:tauri-android` + the two plugins) also works — plugins depend only on `project(":tauri-android")` from `packages/tauri` + maven artifacts; needs `android.useAndroidX=true` in gradle.properties and AGP 8.11/Kotlin 1.9.25 matching gen/android. A `kotlin_test` CI job was drafted 2026-08-04 but the user discarded it; the native-tts `ExampleUnitTest.kt` invalid package (`com.readest.native-tts`) it caught was fixed in #5484 (MERGED).
