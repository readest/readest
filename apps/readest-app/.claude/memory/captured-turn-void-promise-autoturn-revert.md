---
name: captured-turn-void-promise-autoturn-revert
description: "Nightly android-e2e corner-dwell failure root cause - captured turn (#4940) wrapped view.next/prev with `void capturedTurn(...)`, discarding the turn promise; auto-turn guard collapsed and the"
metadata: 
  node_type: memory
  type: project
  originSessionId: 353e9c4d-b3c6-4eeb-9bf1-8254615b2d3d
---

Nightly Android E2E (CDP) lane was red for ~1 month on `selection.android.test.ts > keeps the previous page selected across a corner-dwell auto page turn`. Root cause (proven by on-device event trace; fix MERGED via PR#5159 on 2026-07-17):

`useCapturedTurn.ts` (#4940, merged 2026-07-05) replaces `view.prev/next` with
`(d) => void capturedTurn(...)` — the `void` discards the turn's promise, so every
awaiter of `view.next()` resolves ~300ms before the page actually moves (cssAnimateScroll
is transform-based; scrollLeft only changes at cleanup).

Chain of failure in `useAutoPageTurn.armDwell`:
1. `Promise.resolve(view.next()).finally(...)` fired instantly → `isAutoTurning=false` while the animation still ran.
2. `onAfterTurn` re-anchored the #873 selection scroll-pin (`selectionPosition`) to the STALE pre-turn `containerPosition`.
3. When the animation's final scroll event surfaced, `handleScroll` (un-guarded) pinned the container back to the old page → net-zero turn → e2e poll saw "no turn".
Also caused occasional spurious backward turns reported on device (un-guarded corner machine during the still-running forward animation).

**Why:** any wrapper around `view.next/prev` MUST return the underlying promise — the corner auto-turn, and anything pacing on turns, awaits it. The published FoliateView type says `void` but foliate returns the promise deliberately (TS allows returning Promise from a void-typed fn).

**How to apply:** when wrapping paginator navigation, `return capturedTurn(...)`, never `void capturedTurn(...)`. Unit test pins this: `useCapturedTurn-scrollLock.test.ts > the replaced view.next resolves only when the underlying turn settles`. Key interplay to remember: `handleScroll` #873 pin ↔ `isAutoTurning` guard ↔ `onAfterTurn` re-anchor in [[useTextSelector]]-land; see also [[captured-turn-instant-highlight-scrolllock]].
