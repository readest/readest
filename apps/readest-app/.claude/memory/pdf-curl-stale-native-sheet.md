---
name: pdf-curl-stale-native-sheet
description: "PDF page soft/1px-shifted under a held curl/flip: two causes, stale pre-detail sheet (#7463 MERGED) and a sub-pixel host overflow scrolled by touch (foliate#158-#160 + readest #7469, both MERGED fbb9d039a)"
metadata:
  type: project
---

Found 2026-11-11 on the Xiaomi 13 (dpr 2.75): in Curl/Flip, touching a PDF page showed a softer copy
until release (sometimes 1 device px left). Present on main before #7398. Cause: fixed layouts have no
previewPage, so NativePageTurn captures the destination sheet right after navigating under the cover,
before pdf.js adds the full-dpr detail canvas (base bitmap capped at 2x); `#capture` reuses resident
keys forever. Fix branch fix/pdf-curl-stale-snapshot (worktree readest-fix-pdf-curl-stale-snapshot):
`NativePageTurn.refreshCurrentPage()` + useCapturedTurn MutationObserver on visible page docs for an
added CANVAS. One canvas added per turn, no loop.

Recipe: probe.sh in the session scratchpad = turn, screencap rest, motionevent DOWN+MOVE to open the
curl, screencap held, compare a central crop (ffmpeg blend difference YAVG; shift search dx -2..2).
Before 5-44, after ~0. On this release build neither `window.ipc.postMessage` nor `fetch` hooks see
paper_curl calls; use a MutationObserver over CDP instead.
#7463 MERGED as 80eb7b14f, but the owner still saw it: the second cause.

**Second cause (2026-11-11, foliate-js#158):** the fitted page is sized from the foliate-fxl host's
rounded clientWidth (393) while the host is 392.727px; the host is overflow:auto, so Android WebView
scrolls the 0.27px sliver under a finger (scrollLeft 0 -> 0.364 = 1 device px -> 0 on release, native
only: setter/scrollTo hooks catch nothing). Snapshots taken mid-gesture sit 1px left; the live page
jitters on touch in every mode. Fix: paginated host overflow hidden on an axis unless isOverflowX/Y
(overflowing-x/-y attrs). Headless Chromium (even with Emulation dpr 2.75, mobile) never scrolls a
sub-pixel range, so the browser test checks computed overflow; the device check is the proof.
Shift metric: dxl.sh (left crop, dx/dy search) on rest vs held screenshots: before 2/4 turns 12-19 at
dx=1, after 0.02-0.07 at dx=0. Flip's held page is drawn in 3D, so compare a small-touch frame instead.
Related: [[pdf-push-detail-seam-7397]] [[curl-toolbar-flash-invalidate-cover]]
