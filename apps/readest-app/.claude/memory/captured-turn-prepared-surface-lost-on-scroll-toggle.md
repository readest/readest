---
name: captured-turn-prepared-surface-lost-on-scroll-toggle
description: "FIXED: the captured-turn warm surface survived a whole scrolled session, so the first turn back in paginated animated a stale page over the current one (torn text). Fix = drop the surface when the pipeline goes ineligible"
metadata:
  node_type: memory
  type: project
---

Reported 2026-08-07: slide/curl "does not work as expected" after switching scrolled ->
paginated; fine on a freshly opened book; stays wrong for every turn until the book is
reopened. **Root-caused and fixed, Xiaomi-13-verified.**

**The bug is a stale snapshot.** A warm surface is a *photo of one page*
(`prepareCapture` -> `[data-captured-turn-prepared]`). Scrolled mode makes the pipeline
ineligible (`getCapturedTurnStyle` returns null), so the idle run stopped preparing — **but
nothing dropped the surface already held**. It outlived the whole scrolled session, and the
first turn back in paginated animated that old page over the current one. Two different pages
of the same book, composited with an offset, read as text spliced mid-word.

Device trace, first turn after the round trip: `reuseCachedSurface age: 24958` — a snapshot
from **25 s earlier**, before the mode switch. Every later turn reused a ~1075 ms one.

Fix (10 lines, `runPreparedCapture` in `useCapturedTurn.ts`): when `style` is null, call
`controller.invalidatePreparedCapture()` instead of returning. Covers every way the pipeline
turns off — scrolled, eink, fixed-layout, animation off — with no new observer. Regression
test lives in the existing `useCapturedTurn-scrollLock.test.ts` harness (it must schedule the
idle run via the Settings close path, which only schedules; a `relocate` would invalidate on
its own and pass without the fix).

**Verification method that finally worked — the page number IS the instrument.** Crop the
footer out of a `screenrecord` and tile it over time. A correct slide shows the two layers
one page apart (67 over 68); the bug showed **two apart** (13 over 15). Everything else —
renderer attributes, `viewSettings`, paginator `scrollLeft`, the overlay lifecycle
(`prepared 0.004` -> `active 1`) — is byte-identical between the working and broken states,
so all of it is a dead end.

**Traps that cost hours here:**
- `adb shell input swipe` NEVER engages the captured-turn pipeline (the overlay stays at
  prepared/0.004 for the whole gesture). Every "verified" swipe through it exercises a
  different path. Use CDP `Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'`.
- I first chased a *different* real defect — the warm surface not being re-prepared after the
  switch (view menu is a capture-blocking overlay via `aria-expanded="true"` + its
  `.overlay.fixed.inset-0`, and the blocked idle run left no retry). That fix was reverted: it
  only affected first-turn latency and risked widening the staleness window. If it is ever
  revisited, see git history for `getPreparedCaptureGate`.
- `isCapturedSurfaceBlockedByOverlay()` also reads `useSettingsStore.isSettingsDialogOpen`, a
  store flag with no DOM footprint — querying the selectors from the page and seeing nothing
  does not mean the gate agrees.
- Blind `adb input tap` on the view menu is hopeless (rows shift between modes; I opened
  Paragraph Mode twice). Drive it with DOM `.click()` by `aria-label`, and close the menu by
  clicking the toggle again — `document.body.click()` does not close it and silently keeps
  `blockedByOverlay` true.


## The actual reported bug: three pages sliding (fixed 2026-08-07)

The staleness fix above is real but was NOT what the user reported. Their symptom — "the
current page is shown twice and the previous page is also shown, so like 3 pages are sliding"
— is **two turn engines animating one gesture**.

`applyPageTurnAttributes` writes a mutually exclusive pair: captured config
(`turn-style` removed, `no-swipe` set, `captured-turn-style` set) or paginator config
(`turn-style` set, `no-swipe` cleared, no captured style). `scrolled` is an input to that
decision via `getCapturedTurnStyle`, but **nothing re-applied the attributes when `scrolled`
changed** — unlike `animated` / `pageTurnStyle` / `disableSwipe`, which all call
`applyTurnAttributes()` in their effects. So if anything re-applied while in scroll flow (any
settings change, or a viewer recreation), the renderer kept the paginator config on the way
back to paginated. Then on a swipe the paginator animated it itself (outgoing + incoming) AND
the touch interceptor — which recomputes eligibility **live from viewSettings, not from the
attribute** — ran a captured turn over the top. Three page images, two edge shadows.

Device-reproduced and fixed on a Xiaomi 13. One mid-swipe frame held three footers,
`59 / 112`, `9 / 112`, `60 / 112`; after the fix, two, `59` and `60`. Fix = call the same
`applyPageTurnAttributes` from both places that flip `scrolled`
(`ControlPanel.tsx` and `ViewMenu.tsx`).

**Method note:** hold the drag with CDP `Input.dispatchTouchEvent` (touchStart, moves, no
touchEnd, screencap, then touchEnd) — a mid-swipe screenshot is the only way to see this, and
`adb input swipe` never engages the captured pipeline at all. The renderer attribute triple
(`turn-style` / `captured-turn-style` / `no-swipe`) read straight off `foliate-view.renderer`
tells you which engine owns the gesture without any instrumentation.
