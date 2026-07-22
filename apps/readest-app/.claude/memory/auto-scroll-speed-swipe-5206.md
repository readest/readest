---
name: auto-scroll-speed-swipe-5206
description: "Right-edge swipe adjusts auto-scroll speed, mirroring the left-edge brightness gesture; MERGED"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5de6c875-3c1e-4948-a27e-9807380ece2f
---

Right-edge vertical swipe adjusts Auto Scroll speed, mirroring the left-edge
brightness gesture. MERGED PR #5206 (into main 2026-07-19).

**Pattern (two symmetric edge gestures now exist):**
- Left strip (10%) = brightness: `useBrightnessGesture` + `BrightnessOverlay` + pure `brightnessGesture.ts`.
- Right strip (10%) = auto-scroll speed: `useAutoScrollSpeedGesture` + `AutoScrollSpeedOverlay` + pure `autoScrollSpeedGesture.ts`.
- Both attach capture-phase, non-passive touch listeners on the foliate iframe doc (registered in `FoliateViewer.tsx` `docLoadHandler` alongside brightness), read latest state via `latestRef`, use `screenX/screenY` (paginated docs are many screens wide), and show a transient capsule that fades ~600ms after release.

**Speed-specific differences from brightness:**
- Armed ONLY while `autoScroll.active` (no separate settings toggle). During normal reading the right strip is NOT reserved — brightness's left strip is always armed in the reader.
- Mapping is LINEAR across `MIN..MAX_AUTO_SCROLL_SPEED` (25-500) snapped to `AUTO_SCROLL_SPEED_STEP` (25), not brightness's perceptual `value=pos^2`.
- `useAutoScroll` gained a public `setSpeed(value, persist?)`; `adjustSpeed` (the -/+ pill) routes through it, gesture drags call `setSpeed(v, false)` live and persist once on release. Gotcha found during impl: after renaming the `useState` setter to `setSpeedState`, `startSession` must call `setSpeedState` (not the new public `setSpeed`, which would setVelocity + persist redundantly on every session start).

Overlay renders only when `autoScroll.active`; visibility owned by the hook, displayed speed read from `autoScroll.speed`.

Related: [[auto-scroll-teleprompter-4998]] (the #4998 mode this extends).
