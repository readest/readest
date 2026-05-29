# Gesture-Based Brightness Control (iOS / Android)

GitHub issue: https://github.com/readest/readest/issues/3021

## Summary

Add a left-edge vertical swipe gesture that adjusts screen brightness while
reading, without opening the menu. While adjusting, a vertical progress bar with
a Sun icon appears at the left edge to indicate the current brightness level.

The feature is gated to platforms with native brightness control (iOS and
Android — `appService.hasScreenBrightness`). It is on by default but can be
disabled via a setting, works in both paginated and scrolled modes, and persists
the chosen brightness across sessions.

## Locked decisions

- **Enablement**: on by default for iOS/Android, with an opt-out toggle in
  **Settings → Behavior → Device**. The toggle doubles as the discoverability
  surface and the escape hatch for accidental activation (CEO review, both
  voices). New setting: `swipeBrightnessGesture: boolean` (default `true`) in
  `SystemSettings`.
- **Persistence**: on release, save `screenBrightness` (0–100) and set
  `autoScreenBrightness = false`, exactly like the existing menu slider, so the
  value survives restart and stays in sync with the slider. Undo path: the menu
  slider's "System Screen Brightness" toggle re-enables auto-brightness (CEO
  review: an accidental swipe silently disables auto-brightness; the undo must be
  documented and reachable).
- **Scope**: core only. One opt-out toggle (above). No sensitivity setting, no
  corner choice, no volume gesture, no haptics, no lock.
- **Gesture area**: left **10%** of the view width, in **both** paginated and
  scrolled modes.
- **Direction**: swipe up = brighter, swipe down = dimmer. A full view-height
  drag spans the full 0→100% range.

## Behavior

1. A touch begins inside the left 10% of the view width.
2. It activates as a brightness gesture once movement becomes dominantly
   vertical (`|Δy| > |Δx|`) and passes a ~18px threshold. The threshold is
   deliberately above incidental thumb-jitter (CEO review: 10px was too eager
   for an always-on edge strip).
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

Attach a **dedicated capture-phase, non-passive** touch listener on the iframe
`doc`: `addEventListener('touch{start,move,end,cancel}', fn, { capture: true,
passive: false })`. The callback is a parent-realm closure, so it can call the
device store and React state directly — no `postMessage` or interceptor needed.

**Why capture phase (corrected after eng review — this was a bug in the first
draft).** There are *three* independent touch-listener registrants on the same
`doc`: (1) FoliateViewer's own `postMessage` forwarders (`FoliateViewer.tsx:326`,
passive), (2) the Annotator's non-passive selection listeners (`Annotator.tsx:332`),
and (3) **foliate-js's own paginator** (`packages/foliate-js/paginator.js:1034`,
non-passive, bubble-phase), registered during `view.open()` — i.e. *before* any
app-level listener. The paginator's `touchmove` can `preventDefault()`, set
`#touchScrolled`, and `scrollBy()`. A bubble-phase listener registered later
therefore **cannot** `stopImmediatePropagation` the paginator — it already ran.
Both eng voices (Claude + Codex) independently verified this against `paginator.js`.
A **capture-phase** listener fires before every bubble-phase listener regardless
of registration order, so its `stopImmediatePropagation` suppresses paginator,
Annotator, and FoliateViewer handlers alike.

When the gesture is active, each move/end/cancel calls `preventDefault()` +
`stopImmediatePropagation()`. The latter is the *sole* mechanism that suppresses
the conflicting page-flip / upward-swipe-to-toggle-UI (`useIframeEvents.ts:282` —
also 10px, vertical, left-edge-inclusive); there is no threshold gap to rely on.
The ~18px activation threshold only reduces *accidental* starts.

**Selection guard.** Before arming, the listener checks `doc.getSelection()`; if a
non-collapsed selection exists, it does not arm (mirrors `paginator.js:1622`). This
keeps a vertical text-selection drag that starts in the left strip from being
hijacked into a brightness change.

**Scrolled-mode timing.** In scrolled mode the paginator does not `preventDefault`
(it early-returns at `paginator.js:1613`); native container scroll is what moves
content. `preventDefault` only takes effect once called, so the pre-activation
travel (≤18px) would scroll before brightness takes over. Decision: see the
"Scrolled-strip reservation" item in the review report — the implementation
`preventDefault`s from the first move of any touch that *armed* in the strip
(reserve the strip), so there is no scroll-then-freeze jump.

Before arming, and for taps / horizontal swipes / touches outside the strip, the
listener does nothing, so normal page-turn taps and swipes are unaffected.

Required test: a short upward flick inside the left 10% must adjust brightness and
never toggle the toolbar (asserted by spying `stopImmediatePropagation` with a
fake paginator listener registered *first*, proving capture-phase suppression).

## Components

### `src/app/reader/utils/brightnessGesture.ts` (pure, unit-tested)

- `isInLeftEdge(x: number, viewWidth: number, edgeRatio = 0.1): boolean`.
  **Use `screenX` + the parent `window.innerWidth`, NOT `clientX` /
  `documentElement.clientWidth`.** In paginated mode foliate-js lays content out
  as side-by-side columns, so the iframe document is many screens wide and
  `clientX` is a document coordinate (a left-edge touch on a later page reports a
  large `clientX`). `screenX` is the physical screen position; the listener runs
  in the parent realm so `window.innerWidth` is the real app viewport. (Matches
  how `useIframeEvents` / `usePagination` already do zone detection.)
- `shouldActivate(deltaX: number, deltaY: number, threshold: number): boolean`
  — true when `|Δy| >= threshold && |Δy| > |Δx|`.
- `computeBrightness(startPos: number, deltaY: number, viewHeight: number): number`
  — works in **perceptual position** space (0–1) to match the menu slider:
  `pos = clamp(startPos − deltaY / viewHeight, 0, 1)`, then brightness value =
  `positionToValue(pos)`. Reuse the slider's `pow(0.5)` curve from `ColorPanel.tsx`
  (extract `valueToPosition` / `positionToValue` into this module so there is one
  source of truth — design review, both voices: a linear gesture would land on a
  different number than the slider for the same finger travel). Always clamp the
  seed to `[0,1]` and never feed the `-1` sentinel into the curve.

Constants: `BRIGHTNESS_GESTURE_EDGE_RATIO = 0.1`,
`BRIGHTNESS_GESTURE_ACTIVATION_PX = 18`.

### `src/app/reader/hooks/useBrightnessGesture.ts`

Inert unless `appService.hasScreenBrightness` AND `settings.swipeBrightnessGesture`.

**Latest-closure ref (`latestRef`).** The listener is attached once per doc (the
`isEventListenersAdded` guard) from a `docLoadHandler` that itself is captured
with a `[view]` dependency — so it sees stale render values. Therefore the
listener must read everything runtime-variable from a single `latestRef` updated
each render (mirrors `handlePageFlipRef` / `useTouchInterceptor`): the live
`swipeBrightnessGesture` toggle, `viewSettings.scrolled` / `.vertical`, and the
seed brightness. It must NOT read values captured in the hook's render closure.

**Seed priming (async-race fix).** On mount (when `hasScreenBrightness`), prime a
`seedBrightnessRef`: if `settings.screenBrightness ≥ 0` use it, else
`await getScreenBrightness()`, clamped to `[0,1]`; fall back to `0.5` if the read
fails or returns `< 0`. Multi-pane coherence: seed each gesture-start from the
**shared** `settings.screenBrightness` (via `latestRef`), not a private per-book
cache, so two grid panes don't drift. A late-resolving seed must not overwrite a
value the user has already adjusted this gesture.

Owns refs: `touchStart`, `armed`, `active`, `startPos`, `rafId`, `hideTimer`,
`seedBrightnessRef`, `latestRef`. Exposes `registerBrightnessListeners(doc)` and
`{ overlayVisible, overlayLevel }`.

Listener logic (capture phase):

- **touchstart**: if `!latestRef.swipeBrightnessGesture` → ignore. If
  `doc.getSelection()` is non-collapsed → ignore (selection guard). Else record
  start `clientX/clientY`; `armed = isInLeftEdge(...)`.
- **touchmove**: if `armed`:
  - scrolled mode → `preventDefault()` from this first move (reserve the strip; no
    scroll-then-freeze jump).
  - once `active || shouldActivate(...)`: set `active`, `preventDefault()`,
    `stopImmediatePropagation()`, compute brightness via the perceptual curve,
    coalesce `setScreenBrightness` through a single `requestAnimationFrame`
    (store `rafId`, cancel the prior frame), set `{ overlayVisible, overlayLevel }`.
- **touchend / touchcancel**: if `active`: `preventDefault()`,
  `stopImmediatePropagation()`, **cancel any pending `rafId`**, apply the final
  level deterministically, persist (`saveSysSettings('screenBrightness',
  round(value*100))` + `saveSysSettings('autoScreenBrightness', false)`), schedule
  the overlay hide (`hideTimer`, ~600ms). Always reset `touchStart/armed/active`.
- **teardown**: on hook unmount, `cancelAnimationFrame(rafId)` and clear
  `hideTimer`.

### `src/app/reader/components/BrightnessOverlay.tsx`

A self-contained **capsule** (its own surface — `bg-base-100/90`, `border-base-content/20`)
holding a `PiSun` icon (`react-icons/pi`), a vertical track (`bg-base-content/20`)
filled from the bottom to `overlayLevel` (`bg-base-content`), and a small numeric
`%` label (`Math.round(value*100)`). The capsule surface is required so the
overlay stays legible over any book background (white / sepia / black / image
themes) — a bare bar would vanish on a same-tone page (design review, both voices).

- **Position**: physical `left` + `env(safe-area-inset-left)`, vertically centered
  within the inset-aware content box (not the raw viewport, so it never lands under
  a half-open FooterBar). `z-[15]` (above the z-10 header/footer/Ribbon tier),
  `pointer-events: none`. RTL: keep physical left (user-locked); set `dir="ltr"`
  on the capsule so the `%` reads correctly.
- **Timing (color themes)**: fill height has **no CSS transition** (tracks the
  finger 1:1); the capsule fades in fast (~100ms), holds ~500ms after release,
  fades out ~200ms, then unmounts. Appears immediately on activation, never dims
  the Sun icon with level (full opacity at 0%). 0% keeps the track + border + `0%`
  visible; 100% fills flush.
- **e-ink (`[data-eink]`)**: `eink-bordered`, no shadow/gradient, 1px border, and
  **no continuous animation** — quantize the visual fill to ~10% steps and drop
  the fade (show/hide instantly) so the panel repaints a handful of times, not
  60×/s. Device brightness still updates live; only the overlay repaint is stepped.
- **Reduced motion** (`prefers-reduced-motion: reduce`): drop the opacity fades,
  show/hide instantly (the live fill is functional, not decorative).
- `aria-hidden` (transient; the labeled menu slider is the canonical control).

Positioned `absolute` within the per-book view container (sibling of the iframe in
FoliateViewer), so in a multi-pane grid each book's overlay stays in its own pane.

### `src/app/reader/components/FoliateViewer.tsx`

- `const { registerBrightnessListeners, overlayVisible, overlayLevel } =
  useBrightnessGesture(bookKey)`.
- Call `registerBrightnessListeners(detail.doc)` inside the existing
  `isEventListenersAdded` block. (Capture-phase registration makes ordering moot,
  but keep it in this block so it shares the doc lifecycle.)
- Render `<BrightnessOverlay visible={overlayVisible} level={overlayLevel} />` as a
  sibling of the iframe container.

### `src/types/settings.ts` + `src/services/constants.ts`

Add `swipeBrightnessGesture: boolean` to `SystemSettings` (default `true` in
`DEFAULT_SYSTEM_SETTINGS`). Surface the toggle in the settings UI under
**Behavior → Device** (next to the existing "System Screen Brightness" control in
`ControlPanel.tsx`), gated on `appService.hasScreenBrightness`. i18n: add the
label + description strings.

## Testing

The pure helpers are the easy part; the bug-prone logic is in the listener. Both
layers get tests (eng review: the first draft tested only the trivial helpers).

- **Pure helpers** (`brightnessGesture.test.ts`, failing-first):
  edge detection at the exact 10% boundary; `shouldActivate` at the 18px boundary
  and the `|Δy| == |Δx|` tie; perceptual curve round-trip
  (`positionToValue(valueToPosition(v)) ≈ v`); up = brighter sign; `[0,1]` clamp
  including an unseeded / `-1` start.
- **Listener-level integration** (`useBrightnessGesture.test.ts`): build a fake
  `Document`, call `registerBrightnessListeners`, dispatch synthetic
  touchstart/move/end/cancel sequences, and assert:
  - capture-phase suppression — register a fake paginator listener *first*; a
    left-strip upward flick must call `stopImmediatePropagation` so the fake never
    fires (this is the test that fails with bubble-phase, proving the fix);
  - horizontal swipe in the strip → not activated (page-flip preserved);
  - selection-in-progress in the strip → not hijacked;
  - scrolled mode → `preventDefault` called on the armed pre-activation move;
  - gating → inert when `!hasScreenBrightness` or `!swipeBrightnessGesture`;
  - persistence on end → `saveSysSettings('screenBrightness', …)` +
    `autoScreenBrightness=false` (mock `saveSysSettings`/`setScreenBrightness`);
  - `rafId` / `hideTimer` cancelled on touchend and unmount.
- **Manual on device**: live feel, overlay appear/fade + e-ink stepped repaint,
  scroll reservation in scrolled mode, taps / page-turn swipes still work, and the
  Settings → Behavior → Device toggle disables the gesture.

## Out of scope (deferred)

Sensitivity setting, corner/edge choice, right-edge volume gesture, haptic
feedback, gesture lock. These are listed in the issue but explicitly deferred.

## What already exists (reused, not rebuilt)

- `deviceStore.getScreenBrightness/setScreenBrightness` (0–1) → live brightness.
- `saveSysSettings` + the `screenBrightness` / `autoScreenBrightness` settings →
  persistence, identical to the menu slider.
- `ColorPanel.tsx` perceptual `pow(0.5)` curve → extracted and shared.
- `useTouchInterceptor` / `handlePageFlipRef` → latest-closure ref precedent.
- `Annotator.tsx` non-passive doc listener → precedent (we go one further: capture).
- `appService.hasScreenBrightness` → platform gate.

---

## GSTACK REVIEW REPORT (/autoplan — CEO + Design + Eng, dual voices)

Mode: SELECTIVE EXPANSION. Codex + Claude subagent per phase. Premise confirmed
by user. Plan revised in place per the findings below.

### Consensus

- **CEO**: premise CONFIRMED (parity with Moon+/KOReader). Both voices challenged
  "no toggle", "left edge", "10px". User decided: add opt-out toggle
  (Settings→Behavior→Device, default on); keep left edge; raise to 18px.
- **Design**: e-ink stepped repaint (no continuous animation), self-contained
  contrast capsule, perceptual-curve + `%` label, fill-vs-fade timing split,
  `z-[15]` + `pointer-events:none`, reduced-motion, RTL physical-left + `dir=ltr`.
- **Eng**: 🔴 the original bubble-phase + `stopImmediatePropagation` suppression
  was **refuted by both voices** (foliate-js paginator registers first, bubble) →
  **capture-phase** non-passive listener + `touchcancel`. Plus: selection guard,
  eager+clamped brightness seed, rAF/timer teardown, shared-settings seed for
  multi-pane, iframe-doc coordinate space, listener-level test harness.

### Cross-phase theme

**Gesture-conflict correctness** surfaced in all three phases (CEO flagged the
rationale as unverified; both Eng voices proved it false). Highest-confidence
signal — the capture-phase fix is the single most important change.

### Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Ship the gesture | Premise gate | — | User confirmed; parity feature |
| 2 | CEO | Add opt-out toggle (default on) | User challenge | — | User chose: Settings→Behavior→Device |
| 3 | CEO | Keep left edge | User challenge | — | User chose; preserves overlay placement |
| 4 | CEO | Threshold 10→18px | Taste | P5 explicit | Both voices: 10px too eager |
| 5 | CEO | Document auto-brightness undo path | Mechanical | P1 | Silent side-effect needs reachable undo |
| 6 | Eng | Capture-phase listener + touchcancel | Mechanical | P5 | Both voices proved bubble-phase insufficient |
| 7 | Eng | Selection guard before arming | Mechanical | P1 | Prevent selection hijack in strip |
| 8 | Eng | Eager + clamped brightness seed | Mechanical | P1 | Fix async race on default -1/auto |
| 9 | Eng | rAF / hide-timer teardown | Mechanical | P1 | Prevent stale write / leak |
| 10 | Eng | Listener-level integration tests | Mechanical | P1 | Cover the actual bug-prone branches |
| 11 | Design | Perceptual curve reuse + `%` | Mechanical | P4 DRY | One source of truth vs slider |
| 12 | Design | e-ink stepped, no continuous anim | Mechanical | P1 | Project e-ink rules |
| 13 | Design | Contrast capsule surface | Mechanical | P1 | Legible over any book theme |
| T1 | Eng | Scrolled-strip reservation (preventDefault from arm) | **Taste — open** | P5 | See final gate |
