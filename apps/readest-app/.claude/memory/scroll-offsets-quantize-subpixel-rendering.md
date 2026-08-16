---
name: scroll-offsets-quantize-subpixel-rendering
description: "Measured engine facts: scrollTop quantizes to whole CSS px everywhere; WebKit renders sub-pixel transforms continuously but Blink snaps composited layers to whole device px (only WAAPI escapes it)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4a95bf5c-7219-4a96-9325-c19e6075a74f
  modified: 2026-08-13T14:53:54.691Z
---

Measured 2026-08-13 at dpr 2 (Playwright Chromium + WebKit, and iOS 18.5 simulator Safari)
while making Auto Scroll smooth (readest#5679 + foliate#74, both MERGED).

**Scroll offsets quantize to whole CSS pixels in BOTH engines.** `scrollTop = 100.5` reads
back 101 in Chromium (rounds) and 100 in WebKit (floors). A read-modify-write of `+0.1` per
frame **never moves at all** - this is why any paced scroller must carry the fraction itself
(`PacedScroller`/`Autoscroller` in `src/app/reader/utils/autoscroller.ts` already did). The
smallest thing `scrollTop` can render is 1 CSS px, so slow continuous scrolling steps: Auto
Scroll's minimum is `AUTO_SCROLL_BASE_PX_PER_SEC(20) x 25% = 5px/s` = one jump every 200ms.
No scroll-side tuning fixes this; only a transform can.

**Sub-pixel transform rendering differs by engine** - and `getBoundingClientRect()` CANNOT
see the difference (it reports layout+transform geometry, which looked continuous in both).
Measure actual pixels: move a black bar in 0.1px steps, screenshot, and recover the
intensity-weighted centroid of the antialiased edge (ffmpeg `format=gray` -> rawvideo, sum
`255-v` per row). Results per ten 0.1px steps:

| engine | frames that moved | step |
| --- | --- | --- |
| WebKit (iOS 18.5 + macOS) | 10/10 | ~0.2 device px, continuous |
| Chromium | 2/10 | 1 device px (snapped) |

**Blink snaps composited layers to whole device px.** Not a syntax issue: `translateY`,
`translateY + translateZ(0)` and `translate3d` are identical; a plain `top` offset is worse
(2 device px). So the sub-pixel fix gives WebKit true smoothness and Blink only 2-3x finer
steps (1 device px = 0.5 CSS px at dpr 2, 0.36 at Xiaomi's 2.75).

**A compositor-driven WAAPI animation DOES interpolate sub-pixel in Blink** (measured
deltas -0.318/-0.275/-0.267...). Not adopted: driving the <1px remainder that way needs a
scrollTop resync at every whole pixel (every 200ms at min speed), risking a periodic hitch
instead of a small steady step. Live option if Chrome smoothness is ever demanded.

**Where to put such a transform:** the scrollport (`#container`) - NEVER its children. A
transform on the children shifts their border boxes and shrinks the container's scrollable
overflow, which is exactly what caused [[ios-last-page-scroll-clamp-5663]]. Transforming the
scrollport leaves its scrollable overflow untouched. Keep `translateZ(0)` in the transform
string so the scrolled-mode layer promotion (readest#4470) survives.
