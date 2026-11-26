---
name: auto-scroll-page-wipe-7575
description: Paginated Auto Scroll "roller blind" wipe (#7575) — DOM page copy design, its precision/orientation gotchas at dpr 2.75, and the Xiaomi frame-log + video-shift verification recipe; MERGED #7869 7fb16cb28
metadata:
  type: project
---

MERGED 2026-11-24 as #7869 (7fb16cb28), after #7619/#7624/#7633 shipped a View
Transition version that never worked on iOS 18 (no layered VT) or Android
(skipped while the controls showed; a tap on Play leaves them up).

Design (`src/app/reader/utils/pageWipe.ts`, `useAutoScroll.ts`): the page being
read is a still copy (sandboxed same-origin iframe per section, `importNode` of
the root, cached until a MutationObserver marks it stale) laid over the view
and clip-pathed behind the divider; the live view turns one page ahead under
it. Vertical books wipe right→left (`data-axis` on the divider). During a
session: no turn animation at all (captured curl/flip/slide gated in
useCapturedTurn by the store flag, `animated` removed, `no-swipe` in wipes);
pause freezes the wipe; the copy takes every page touch (brightness swipe is
registered on the copy host too).

Gotchas that each cost a device round:
- Size the copy from `getBoundingClientRect`, not `offsetWidth` (393 for
  392.727) or computed style (392.727px → floors to 1079.98 device px at dpr
  2.75): vertical text, laid out from the right, jumped 1 device px.
- The root's inline height is serialized to 6 significant digits by
  `importNode` (872.7272 → 872.727): columns a hair short, drift ~0.2 css px
  down a long section. Re-set the copied root's width/height from the source
  root's rect.
- `applyOrientationMedia` edits CSSOM, which `<style>` text doesn't carry:
  re-apply it on the copy with the reading area's orientation.
- Drop the copy in `advance()` the moment progress passes the length; a
  render before the queued `#complete` gave the old copy the next wipe's
  (full-page) clip — the "50%" flash at each new wipe.

Verification recipe (Xiaomi, CDP on 9223): a rAF logger of the copy layer
(visibility, clip path, copy iframe top vs source frame top, line transform),
then check no frame shows the old copy after the line restarts; screen
recordings + ImageMagick RMSE over ±2 px offsets of the page just before vs
0.4 s after a commit (`dx=0 dy=0`, RMSE ≤ 0.0005 when right). Native curl
activity: logcat `SkJpegEncoder` / `VRI[PopupWindow` (see
[[android-fault-injection-window-ipc-hook]]; patching
`__TAURI_INTERNALS__.invoke` logs nothing).

Device hygiene: after a reinstall the library's first cover may be a
different book (The Hobbit got driven by mistake); check `document.title`
before starting a session, and note the page to restore. Writing Mode set via
Settings → Layout persisted only when set while the book was open.

Not verified: iOS on the final build (iPhone needed USB "Allow accessory"
and a Mirroring resume), dark/e-ink/RTL on a device.
