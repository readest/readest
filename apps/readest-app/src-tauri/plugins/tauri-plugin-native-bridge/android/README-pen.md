# BOOX Pen SDK (handwriting, issue #3673)

Handwriting works on every platform through browser pointer events
(`src/services/handwriting/pointerBackend.ts`). On BOOX devices an opt-in
build flavor adds low-latency raw drawing through the Onyx Pen SDK, which
paints strokes straight onto the e-ink panel while the pen moves.

## Why it's opt-in

`com.onyx.android.sdk:onyxsdk-pen` (with its `onyxsdk-base`, `onyxsdk-device`
and `onyxsdk-commons-io` dependencies) is served only from BOOX's Maven host,
`https://repo.boox.com/repository/maven-public/`. Default builds never declare
that repository and never link the SDK.

The `pen` flavor dimension picks the implementation of `PenInputController`:

- `genericPen` (default): `android/src/genericPen`, a no-op controller.
- `booxPen`: `android/src/booxPen`, the only code that touches Onyx types.

## Building the BOOX flavor

Set the `penFlavor` Gradle property; it both selects the flavor and adds the
BOOX repository:

```bash
# from apps/readest-app
ORG_GRADLE_PROJECT_penFlavor=booxPen pnpm tauri android build -t aarch64
```

## Coordinates

JS sends the drawing region and pen width in CSS px; the plugin scales them
by the WebView's display density, runs the SDK on the WebView, and scales the
returned points back to CSS px. Each stroke arrives in JS as one batch on
pen-up (`onRawDrawingTouchPointListReceived`), with pressure normalized to
0..1 by `EpdController.getMaxTouchPressure()`.
