---
name: notch-mask-texture-4486
description: "Scrolled-mode top inset mask occluded the bg texture; clip-path full-cell trick aligns the mask's texture tiles with the viewer's; CDP-inject + MAE seam verify"
metadata: 
  node_type: memory
  type: project
  originSessionId: 47d2276d-0e04-455c-99b5-4fd0a651b579
---

#4486 (PR #4563): in scrolled mode the `notch-area` in `SectionInfo.tsx` masks the top
safe-area inset with opaque `bg-base-100` at z-10 (hides content scrolling under the
status bar) — and painted over the texture (`.foliate-viewer::before` lives at the z-0
paint layer, see [[paginated-texture-occlusion-4399]]). Flat untextured strip across the
unsafe header area.

**Fix pattern (paint-box matching).** A texture `::before` only tile-aligns with the
viewer's when `background-size: cover/contain` resolves against the SAME element box.
So: make the mask span the grid cell (`inset-0`) and clip the visible+hit area to the
strip with `clip-path: inset(0 0 calc(100% - topInsetPx) 0)`; add `.notch-masked::before`
to the selector group in `styles/textures.ts`, gated by a conditional class only in
scrolled-horizontal mode (paginated/vertical notch is transparent — texturing it would
double-texture over the viewer's). `mix-blend-mode: multiply` blends against the mask's
own opaque bg inside its z-10 stacking context → identical color math to the viewer area.
clip-path clips hit-testing too, so the click target stays the strip (verified with
`elementsFromPoint`: notch present in stack inside strip, absent mid-screen).

**Still texture-unaware** (same flaw, not yet reported): the vertical scrolled-mode side
masks in `BooksGrid.tsx` (`bg-base-100 absolute left-0/right-0 h-full` when
vertical+scrolled). Same trick applies if reported.

**Verification technique (no rebuild).** Drive the installed app on the device via
adb+CDP ([[cdp-android-webview-profiling]]) and inject the exact CSS artifacts the fix
produces (patch the `#background-texture` style text + classList/style edits — React
won't wipe manual DOM edits unless its computed className/style prop string changes
between renders). Quantify the seam: `magick compare -metric MAE` between adjacent
1px rows across the boundary — buggy hard seam was MAE 11913 (16-bit scale), fixed
seam 230 ≈ ordinary texture-row variation. Gotchas: adb taps at status-bar y-coords are
consumed by SystemUI (never reach the app) — use elementFromPoint or in-page click
counters for hit-testing; a mid-screen tap toggles the header/footer chrome which then
sits ABOVE the notch and pollutes hit stacks (toggle it off before probing).
