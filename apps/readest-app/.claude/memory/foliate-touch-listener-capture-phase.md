---
name: foliate-touch-listener-capture-phase
description: "To intercept/suppress reader touch gestures from the app, use capture-phase listeners — foliate-js's paginator registers bubble-phase doc listeners first"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4b0bfcd2-a4ed-4b3c-99c2-b3c37ef7c530
---

There are **three** independent touch-listener registrants on the foliate iframe `doc`:
1. `FoliateViewer.tsx` (~line 326) — passive forwarders that only `postMessage`.
2. `Annotator.tsx` (~line 332) — non-passive, drive text selection.
3. **foliate-js's own paginator** (`packages/foliate-js/paginator.js:1034`) — non-passive, **bubble-phase**, registered during `view.open()` (so *before* any app-level `load` handler). It can `preventDefault`, set `#touchScrolled`, `scrollBy`.

Consequence: a bubble-phase app listener registered "before the existing FoliateViewer listeners" **cannot** `stopImmediatePropagation` the paginator — the paginator already ran. Registration order only controls listeners within the same phase, and the paginator's are earlier regardless.

**Fix pattern:** register with `{ capture: true, passive: false }`. Capture-phase listeners on `doc` fire before all bubble-phase listeners when the event target is a descendant, so capture-phase `stopImmediatePropagation()` suppresses paginator + Annotator + FoliateViewer handlers alike. Scrolled mode also needs `preventDefault` from the first armed move (the paginator early-returns on `scrolled`, so native container scroll is what moves content).

Verified end-to-end for the [[brightness-swipe-gesture]] feature (test asserts a bubble-phase paginator stand-in never fires after a capture-phase `stopImmediatePropagation`). Both Codex and a Claude subagent independently confirmed against `paginator.js` during the /autoplan review.
