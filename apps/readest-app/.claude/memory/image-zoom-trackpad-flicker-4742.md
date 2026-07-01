---
name: image-zoom-trackpad-flicker-4742
description: "Trackpad pinch-zoom flickered the image viewer; macOS pinch = ctrl+wheel stream, disable CSS transition during continuous gestures"
metadata: 
  node_type: memory
  type: project
  originSessionId: affbfa14-0152-4d69-8fce-f7e0b9ee97a3
---

ImageViewer (`src/app/reader/components/ImageViewer.tsx`) flickered when zooming an open image with a MacBook trackpad pinch (#4742, PR #4748).

**Root cause:** on macOS a trackpad pinch-to-zoom is delivered to the WebView as a rapid stream of `wheel` events with `ctrlKey: true` (NOT touch events), so it flows through `handleWheel`. The zoomed `<img>` kept its `transition: transform 0.05s ease-out` whenever `isDragging` was false. Pinch wheel events fire faster than 50ms apart, so each event restarted the in-flight transition from its interpolated mid-point — the transform constantly lagged and caught up = visible flicker. Same root cause as the #4451 pan flicker, which only fixed the pan path and (via `isDragging` set in `onTouchStart`) the touch-pinch path; the wheel-zoom path was the only continuous gesture left with the transition on. That's why touch pinch on iPhone was smooth but trackpad pinch flickered.

**Fix:** added an `isWheelZooming` state set on each `handleWheel` event and cleared on a 200ms debounce (wheel has no explicit gesture-end). Transition is `isDragging || isWheelZooming ? 'none' : 'transform 0.05s ease-out'`. Discrete zoom (buttons, double-click, keyboard) keeps the smoothing.

**General pattern:** never run a CSS `transition` on a transform that's being updated by a high-frequency continuous input stream (drag, touch pinch, trackpad/`ctrl+wheel` pinch) — the interrupted-transition restart flickers. Gate the transition off for the duration of the gesture. Maintainer couldn't repro on macOS 15.6.1 (WebKit) while reporter hit it on macOS 26.5.1 / WebKit 605.1.15; the fix is version-independent. Related: [[instant-highlight-tap-paginate]].
