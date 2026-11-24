---
name: leaf5c-adb-handwriting-demo
description: Recipe for drawing realistic handwriting into Readest on the Leaf5C over adb (motionevent + pauses + Hershey script font); Leaf5C HAS a pen digitizer
metadata:
  node_type: memory
  type: reference
  originSessionId: ad4bac7c-eb46-4386-b81a-88dfecab9eae
  modified: 2026-10-21T07:47:56.882Z
---

Leaf5C (serial 10591e47, Android 13, 1264x1680, Readest 0.12.16, zh-CN UI) has a pen digitizer, `onyx_emp_istaric_pen`
(/dev/input/event7). The plain Leaf5 does not, see [[boox-pen-sdk-build-gotchas]]. `sendevent` to it is SELinux-denied for shell.

Drawing demo ink (2026-10-21, Odyssey p.71):
- Use `input motionevent DOWN/MOVE/UP` (touchscreen source) in a pushed shell script. Put `sleep 0.25` after DOWN and
  `sleep 0.5` after UP. Without the pauses, short strokes (dots, small letters) are dropped.
- `input stylus motionevent` dropped strokes and somehow left the reader on another page. Avoid it.
- Glyphs: pip `Hershey-Fonts`, font `scripts`, ~58px tall, slant 0.18, with small jitter.
- In the dock, tapping the pen icon TOGGLES the color palette. Detect state from a screenshot before tapping a swatch,
  or every mark comes out the same color.
- Undo did nothing: cause confirmed as sync reload wiping undo history, see [[ink-sync-reply-drops-strokes]].
- To watch the user's real pen input: `getevent -lt` (pen = event6 `onyx_emp_istaric_pen`, ABS 0..6759 x 0..9099,
  scale to 1264x1680; finger = event5) + 1 s screencap loop + logcat.
- The "eraser" stray highlight was not the eraser: drawing mode had already closed (why: unknown), so the er.sh
  swipe hit the reader and Instant Highlight made it a highlight. Check the dock is up before every batch.
- 2026-10-21 the device took BOOX OS 4.2.3; the reader then showed the status bar, reflowed, and the slow-injected
  "coming of age!" note split apart (strokes >4 s apart got separate anchors, BURST_MS). Someone else uses this
  device too: check the screen before injecting input.
- Related sync race fixed separately: [[ink-sync-reply-drops-strokes]].

Related: [[handwriting-ink-6674]].
