---
name: pinch-vs-twofinger-scroll-4858
description: "Fixed-layout pinch-zoom too sensitive on touchscreen laptops (#4858); distinguish two-finger scroll (same direction) from pinch (opposite) via pending state + deadzone in useIframeEvents.useTouchEvent"
metadata: 
  node_type: memory
  type: project
  originSessionId: ca71550d-0c81-44d1-b990-3892dc514d77
---

Issue #4858: on 2-in-1 touchscreen laptops (Surface) reading PDFs webtoon-style, a two-finger **scroll** accidentally triggered zoom. User wanted NO zoom-lock option — just make pinch less sensitive and distinguish same-direction (scroll) from opposite-direction (pinch).

**Where:** `src/app/reader/hooks/useIframeEvents.ts` `useTouchEvent`. Pinch only engages for `getBookData(bookKey)?.isFixedLayout` (PDF / fixed-layout EPUB). Touch events are forwarded from the foliate iframe as `iframe-touch{start,move,end}` postMessages (passive listeners, no preventDefault, so native two-finger scroll happens regardless — the old bug was that we ALSO zoomed).

**Old bug:** `onTouchStart` set `isPinchingRef=true` immediately on any two-finger touch and `onTouchMove` applied `ratio=currentDist/initialDist` from the very first move. Real human scroll isn't perfectly parallel, so finger separation drifts → ratio ≠ 1 → accidental zoom; `onTouchEnd` committed `round(initialZoom*lastRatio)`.

**Fix — pending state + magnitude discriminator + deadzone:**
- `onTouchStart` (two fingers, fixed layout): enter `pinchPendingRef=true` (NOT `isPinchingRef`), stash both initial touches (`initialTouch0/1Ref`), `initialPinchDist`, `initialZoom`.
- `onTouchMove` while pending: compute `separationDelta=|currentDist-initialDist|` and `panDist` = magnitude of the **midpoint travel** `((Δt0+Δt1)/2)`. Pinch keeps midpoint still while separation changes; scroll moves midpoint while separation barely shifts. Decide: pinch if `separationDelta >= PINCH_ACTIVATION_THRESHOLD(24) && separationDelta > panDist`; scroll (bail, native scroll takes over) if `panDist >= TWO_FINGER_PAN_THRESHOLD(12) && panDist >= separationDelta`; else keep waiting. This magnitude compare IS the "opposite vs same direction" test (more robust than a raw dot-product sign).
- On pinch confirm: re-baseline `initialPinchDist = currentDist` so zoom starts at 1x from the activation point — the deadzone travel is absorbed, no snap/jump.
- `onTouchEnd`: guard is now `isPinchingRef || pinchPendingRef`; only commit the `pinch-zoom` dispatch when `wasPinching` (a pending-only or scroll-resolved gesture leaves zoom untouched).

Thresholds bias toward scroll (pan needs only 12px, pinch needs 24px separation) = "less sensitive". Uses `screenX/screenY` (not client) because `pinchZoom` CSS-transforms the iframe parent and oscillates client coords. Tests: `src/__tests__/hooks/useTouchEvent.test.tsx` (same-direction scroll → no zoom; opposite → zoom; jitter < deadzone → no zoom). Related: [[scrolled-pdf-pinch-zoom-4817]] (foliate `pinchZoom`/`pinchEnd` live scale + commit), [[image-zoom-trackpad-flicker-4742]] (macOS trackpad pinch = ctrl+wheel, different path via `useMouseEvent`).
