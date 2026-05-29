# Gesture-Based Brightness Control (iOS / Android)

GitHub issue: https://github.com/readest/readest/issues/3021

## Summary

Add a left-edge vertical swipe gesture that adjusts screen brightness while
reading, without opening the menu. While adjusting, a vertical progress bar with
a Sun icon appears at the left edge to indicate the current brightness level.

The feature is gated to platforms with native brightness control (iOS and
Android — `appService.hasScreenBrightness`). It is always on (no settings
toggle), works in both paginated and scrolled modes, and persists the chosen
brightness across sessions.

## Locked decisions

- **Enablement**: always on for iOS/Android. No settings toggle.
- **Persistence**: on release, save `screenBrightness` (0–100) and set
  `autoScreenBrightness = false`, exactly like the existing menu slider, so the
  value survives restart and stays in sync with the slider.
- **Scope**: core only. No sensitivity setting, no corner choice, no volume
  gesture, no haptics, no lock.
- **Gesture area**: left **10%** of the view width, in **both** paginated and
  scrolled modes.
- **Direction**: swipe up = brighter, swipe down = dimmer. A full view-height
  drag spans the full 0→100% range.

## Behavior

1. A touch begins inside the left 10% of the view width.
2. It activates as a brightness gesture once movement becomes dominantly
   vertical (`|Δy| > |Δx|`) and passes a ~10px threshold.
3. While active, device brightness updates live (throttled via
   `requestAnimationFrame`), and the overlay shows the current level.
4. On release, the value is persisted (`screenBrightness` + `autoScreenBrightness
   = false`) and the overlay fades out shortly after.

Brightness mapping: `next = clamp(startBrightness − Δy / viewHeight, 0, 1)`,
where `startBrightness` is the device brightness captured at activation.

## Conflict suppression (key design point)

The existing iframe touch listeners (`FoliateViewer.tsx` ~line 326) are passive
and forward events via `postMessage` to `useTouchEvent` / the interceptor chain,
which drives page-flip swipes and the upward-swipe-to-toggle-UI behavior. In
scrolled mode the iframe also scrolls natively on a vertical drag.

To reserve the left strip cleanly, attach a **dedicated non-passive** touch
listener on the iframe `doc` (precedent: `Annotator.tsx:332` uses
`{ passive: false }` on the same `detail.doc`). The callback is a parent-realm
closure, so it can call the device store and React state directly — no
`postMessage` or interceptor needed. It is registered **before** the existing
`touchstart/touchmove/touchend` listeners in the same block.

When the gesture is active, each move/end calls:

- `preventDefault()` → cancels native scrolling in scrolled mode.
- `stopImmediatePropagation()` → the existing `handleTouchMove/End` never fire,
  so page-flip swipe and the UI-toggle gesture are both suppressed.

Before activation, and for taps / horizontal swipes / touches outside the strip,
the listener does nothing, so normal page-turn taps and swipes are unaffected.
The activation threshold (~10px) is below the page-flip swipe threshold (30px),
so a page flip can never trigger once a brightness gesture has started.

## Components

### `src/app/reader/utils/brightnessGesture.ts` (pure, unit-tested)

- `isInLeftEdge(clientX: number, viewWidth: number, edgeRatio = 0.1): boolean`
- `shouldActivate(deltaX: number, deltaY: number, threshold: number): boolean`
  — true when `|Δy| >= threshold && |Δy| > |Δx|`.
- `computeBrightness(start: number, deltaY: number, viewHeight: number): number`
  — `clamp(start − deltaY / viewHeight, 0, 1)`.

Constants: `BRIGHTNESS_GESTURE_EDGE_RATIO = 0.1`,
`BRIGHTNESS_GESTURE_ACTIVATION_PX = 10`.

### `src/app/reader/hooks/useBrightnessGesture.ts`

Inert unless `appService.hasScreenBrightness`. Owns refs:
`touchStart`, `armed`, `active`, `startBrightness`, and `currentBrightnessRef`
(seeded once from `settings.screenBrightness / 100` when ≥ 0, else from
`getScreenBrightness()`; kept current as the gesture sets it). Exposes:

- `registerBrightnessListeners(doc: Document)` — attaches the non-passive
  touchstart/move/end listeners (uses a latest-closure ref so listeners attached
  once always see current values, mirroring `useTouchInterceptor`).
- `overlayVisible: boolean`, `overlayLevel: number` (0–1) — for the overlay.

Listener logic:

- **touchstart**: record start `clientX/clientY` + time; `armed = isInLeftEdge(...)`.
- **touchmove**: if `armed` and (`active` or `shouldActivate(...)`):
  set `active`, `preventDefault()`, `stopImmediatePropagation()`, compute
  brightness, throttle `setScreenBrightness` via `requestAnimationFrame`, set
  `{ overlayVisible: true, overlayLevel }`.
- **touchend**: if `active`: `preventDefault()`, `stopImmediatePropagation()`,
  persist (`saveSysSettings('screenBrightness', round(level*100))` +
  `saveSysSettings('autoScreenBrightness', false)`), update
  `currentBrightnessRef`, schedule overlay hide (~600ms). Reset refs.

### `src/app/reader/components/BrightnessOverlay.tsx`

Vertical rounded track at the left edge, vertically centered, offset by
`env(safe-area-inset-left)`. A `PiSun` icon (from `react-icons/pi`) sits above
the track; the track fills from the bottom to `overlayLevel`. Visible while
adjusting, fades out ~600ms after release. e-ink: `eink-bordered`, no shadow,
crisp 1px border. Positioned `absolute` within the book view container above the
iframe.

### `src/app/reader/components/FoliateViewer.tsx`

- `const { registerBrightnessListeners, overlayVisible, overlayLevel } =
  useBrightnessGesture(bookKey)`.
- Call `registerBrightnessListeners(detail.doc)` inside the existing
  `isEventListenersAdded` block, before the existing touch listeners.
- Render `<BrightnessOverlay visible={overlayVisible} level={overlayLevel} />`.

## Testing

- **TDD (failing-first)**: `src/__tests__/.../brightnessGesture.test.ts` covers
  the three pure helpers: edge detection at the 10% boundary, vertical-dominant
  activation thresholds, up = brighter direction, and 0–1 clamping.
- **Manual on device**: live feel, overlay appearance/fade, scroll suppression
  in scrolled mode, and that taps / page-turn swipes still work.

## Out of scope (deferred)

Sensitivity setting, corner/edge choice, right-edge volume gesture, haptic
feedback, gesture lock. These are listed in the issue but explicitly deferred.
