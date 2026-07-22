---
name: layered-snap-vertical-swipe-random-turn
description: "Slide (VT layered) mode randomly turned pages on vertical swipes (Xiaomi WebView 148); TWO last-sample-velocity paths, the dominant one being wobble-started drags committed on lift-off flick; whole-gesture alignment fix, device-verified on rebuilt APK"
metadata: 
  node_type: memory
  type: project
  originSessionId: 81e2afbf-8610-487b-936b-f4066195294c
---

Xiaomi (Android 16, WebView 148), slide turn style (= VT LAYERED path there,
WebView >= 140 passes `detectViewTransitionGroup`): a vertical toolbar-toggle
swipe randomly turned the page forward/backward or not at all. Push/curl are
immune because they never run the layered code (push has no turn-style;
Tauri curl always routes through the app's captured pipeline whose
interceptor gates on whole-gesture |dx|>|dy| already).

**TWO buggy paths in paginator.js, both judging by last-sample velocities:**
1. **Dominant (real finger) path:** the finger LANDS WITH A SIDEWAYS WOBBLE;
   `#layeredDragStart`'s cumulative gate (|dx| >= max(|dy|, 12), re-checked
   per move) passed on the wobble alone before any vertical distance
   accumulated → a VT drag silently started → `#onTouchEnd`'s DRAG branch
   committed it on lift-off flick (`|vx| > 0.3`, last sample = jitter).
   Direction = wobble sign x flick sign → random.
2. Without a drag, `snap()` judged alignment by `|vx|*2 > |vy|` (last
   sample) and the non-drag-follow displacement heuristic (`avgVelocity *
   size * 10` — layered/eink/animation-off) amplified ~15px of net x-drift
   into a full page.

**DELIVERY:** BOTH MERGED — foliate readest/foliate-js#57 (squash
`c19750a8`) and app readest#5185 (submodule bump + regression tests).
The iOS selection/instant-highlight arc also merged as readest#5184. GOTCHA: the submodule's configured remote is named `Blyrium`
(git@github.com:Blyrium/foliate-js.git) and REJECTS pushes (read-only
redirect); the canonical push target is `git@github.com:readest/foliate-js.git`
where chrox has ADMIN — push there explicitly.

**THREE defects total (user-confirmed fixed; foliate fork commit `8bfe7cd`,
branch `fix/layered-snap-gesture-alignment`):**
1. Wobble-started drags (above): start gate now needs 24px horizontal
   travel + 1.5x dominance (a landing wobble stays under ~20px), and the
   release cancels any drag whose whole gesture is predominantly vertical.
2. snap() alignment: cumulative |dx| > |dy| for displacement-judged
   releases (drag-follow/push keeps flick-based).
3. **THE FLASH (kept reproducing after 1+2): fractional-DPR same-page
   settle.** At dpr 2.75 `containerPosition` rests ~0.0001px off the page
   offset, so `#scrollTo`'s EXACT-equality short-circuit missed on every
   release and the 'snap' reason ran a FULL-PAGE layered view transition to
   the page it was already on — a visible slide flash on every vertical
   swipe with zero page change (probe signature: vt=1 even for perfectly
   straight swipes, snap wrapper never called for drags). Fix: short-circuit
   accepts |delta| < 1px, and the layered path engages only when
   |offset - containerPosition| > size/2. Desktop Chromium lands on exact
   integers — reproduce in browser tests by writing `containerPosition +=
   0.5` (persists at deviceScaleFactor 2; ASSERT it persisted).
GOTCHA while fixing: `layered` in #scrollTo carries the STYLE STRING into
`#viewTransitionTurn(offset, reason, style)` — an `&&`-chained comparison
turned it into `true` and silently broke the choreography class
(`foliate-vt-true`); the existing slide/curl tests caught it.
Regression tests (lift-off hook, wobble-start, sub-pixel settle) in
`paginator-turn-styles.browser.test.ts` — the wobble test needs
`paginator.next()` x2 first (at section page 0 a backward drag cannot start
and the bug hides).

**VERIFICATION LESSON (I shipped a wrong fix first):** my initial synthetic
repro used perfectly straight vertical moves bending only at the LAST sample
→ it only exercised path 2 (snap), and the monkey-patched "validation"
validated only that path. The user's real finger hit path 1, untouched. What
cracked it: CDP instrumentation on the device (wrap `renderer.snap` to log
args + wrap `document.startViewTransition` to count) revealed `snap` was
NEVER CALLED and a VT started on every real-ish gesture → the drag branch.
**Synthetic gestures must model how fingers actually move (landing wobble,
lift-off hook), and instrument WHICH code path runs — do not assume the path
you analyzed is the path executing.** Final verification = rebuild the APK
(`pnpm dev-android`) and re-run the gesture matrix on the fixed build:
7 vertical variants no turn, horizontal still turns. In-page TouchEvent
dispatch via CDP evaluate remains the repro vehicle (adb input swipe is
perfectly straight = useless for jitter bugs; chained motionevent hits the
80ms velocity-staleness reset).
