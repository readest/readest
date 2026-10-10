# BOOX Pen SDK (handwriting, issue #3673)

Readest's handwriting feature works on every Android build via the generic
browser pointer-event backend (`services/handwriting/*` in the TS app). BOOX
low-latency raw-drawing is an **opt-in** enhancement, not a requirement.

## Why it's opt-in

`com.onyx.android.sdk:onyxsdk-pen` is published only from BOOX's own Maven
host (`https://repo.boox.com/repository/maven-public/`), not Maven Central or
Google's Maven. The artifact's own license (bundled with the demo at
onyx-intl/OnyxAndroidDemo) is Apache 2.0, but:

- it is not mirrored anywhere Readest's normal FOSS/Play CI can reach without
  adding a new, BOOX-controlled repository to every build;
- its transitive dependencies have not been audited here;
- pulling it into the default build would mean every Readest install fetches
  a third-party binary it will almost never use (BOOX hardware only).

So the default `genericPen` Gradle flavor never adds the repository or the
dependency. A separate `booxPen` flavor does, and it's the only place in the
codebase that references Onyx SDK types
(`android/src/booxPen/java/PenInputControllerFactory.kt`). Nothing else in
`NativeBridgePlugin` or the TS app depends on it existing — see
`PenInputController.kt` for the seam.

## Building the BOOX flavor

```bash
# from src-tauri/gen/android
./gradlew assembleGenericPenFossDebug   # default, no BOOX dependency
./gradlew assembleBooxPenFossDebug      # pulls onyxsdk-pen
```

or pass `-PpenFlavor=booxPen` through the normal Tauri Android build.

## What has NOT been verified here

This was implemented without physical BOOX hardware or a configured Android
SDK/NDK in the working environment, so:

- `android/src/booxPen/**` has not been compiled — it's written directly
  against the documented `TouchHelper` / `RawInputCallback` API
  (onyx-intl/OnyxAndroidDemo, `doc/Onyx-Pen-SDK.md`) but package/class names,
  method signatures, and the exact shape of `TouchPoint` should be
  double-checked against the actual `onyxsdk-pen:1.4.11` jar before shipping.
- No raw-drawing session has run on a real BOOX device end to end.
- `EpdController.getMaxTouchPressure()` is used in `canRawDraw()` as a cheap
  "is the native layer actually present" probe; confirm it's safe to call
  before `TouchHelper` is initialized, on real firmware.

Everything else — the handwriting data model, coordinate transform,
canvas renderer, editor (undo/redo/erase), capability-detection fallback
logic, and the generic pointer backend — is unit-tested and does not depend
on BOOX hardware.
