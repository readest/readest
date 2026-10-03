---
name: sheet-swipe-dismiss-anywhere-6089
description: "#6089 dismiss bottom sheets by swiping down from anywhere - MERGED #6097; Dialog is the shared sheet chassis, useSwipeToDismiss is a parallel one, and useDrag leaked its shield on touchcancel"
metadata:
  node_type: memory
  type: project
---

**#6089 → PR #6097, MERGED 2026-09-06 as squash `1b4180c39`. NEVER verified on a
device** — no build was ever installed; the Xiaomi CDP session was set up and then
abandoned. Everything below is unit-test evidence only.

**Two commits:** `feat(ui)` swipe-from-anywhere, then `fix(ui)` touchcancel teardown
(CodeRabbit caught the second, correctly).

## The sheet chassis is split in two — check both

`src/components/Dialog.tsx` is the bottom sheet for the dictionary, note editor, TTS
player, Settings, BackupWindow, ReadingRuler — every `<Dialog>`. It owns `snapHeight`.

`src/hooks/useSwipeToDismiss.ts` is a SEPARATE, older implementation of the same
gesture (PR #3548/#3849) used ONLY by SideBar and Notebook. **Dialog does not use it
and cannot** — it has no `snapHeight` support. A first sweep for "the bottom sheet
code" finds one and misses the other; grep `useDrag(` to find all of them
(`Dialog`, `useSwipeToDismiss`, `usePanelResize`).

## The swipe gate (Dialog)

Armed on `touchstart` on `.modal-box`, takes over only after 8px of mostly-vertical
downward movement — below that the touch still belongs to the content, so taps and
scrolls are untouched. Backs off for: a target with `scrollTop > 0` anywhere up to
the modal box (that scroller owns the gesture), `input`/`textarea`/`select`/
`contenteditable` (catches the TTS seek bar for free), sideways or upward movement,
`!dismissible`, multi-touch, desktop viewport, `.drag-handle` (it starts its own drag).

Drag positioning is now **grab-offset relative** (`clientY - modal.getBoundingClientRect().top`
captured at drag start) instead of pinning the sheet's top edge to the finger. The old
absolute mapping only looked right because the handle sits at that edge.

## useDrag leaked its shield on touchcancel (pre-existing, fixed here)

`useDrag` covers the viewport with a `.drag-shield` (`z-index: 2147483647`,
`pointer-events: auto`, added for #5043 so a release over a PDF iframe still ends the
drag) and removed it ONLY on `touchend`/`mouseup`. There was no `touchcancel`
listener, so a system-stolen touch (Android edge-swipe back, notification shade,
incoming call) left the shield installed, `userSelect` pinned off and the window
listeners attached. **The next tap anywhere landed on the shield, was swallowed, and
was then read as a drag release** with whatever velocity the stale coordinates implied
— which for a sheet can dismiss it.

Fix: `touchcancel` runs the same teardown and reports `canceled: true` on the
`onDragEnd` payload (new required field — a cancelled drag carries no decision).
`Dialog` restores to its resting snap and skips the haptic; `useSwipeToDismiss` slides
the panel back; `usePanelResize` reads only absolute `clientX` and passes no
`onDragEnd`, so it needed nothing.

## Test notes

jsdom has no `Touch`/`TouchEvent` constructor — build a stand-in with
`new Event(type, {bubbles:true})` + `Object.assign(e, {touches:[t], changedTouches:[t]})`;
React's synthetic handlers pick it up fine. `isMobile` is read from
`window.innerWidth/innerHeight` at render, so redefine both BEFORE `render()`.
jsdom reports every scroll metric as 0, so pin `scrollTop` with `Object.defineProperty`.

Related: [[eink-class-substring-matchers]], [[feedback-always-verify-on-xiaomi]].
