---
name: fixed-layout-turn-evicts-touched-frame
description: "Backward page curl froze on PDF/CBZ after #6246 — fixed-layout.js evicted the iframe under the finger mid-turn, killing the touch sequence with no touchend; root-cause trace, why scripted drags missed it, fix = LRU stamp the outgoing spread (foliate-js #100)"
metadata:
  type: project
---

Follow-up to [[fixed-layout-page-curl-6239]]. chrox: "backward curl sticks ~50px from the left edge, cannot turn back again; taps fine; swipe right reproduces every time." Fix: **foliate-js #100 MERGED** (squash `085ab9c` on foliate main; my branch commit c9870a8 orphaned — re-pinned both readest branches, see the squash-re-pin trap in [[fixed-layout-page-curl-6239]]) + readest PR (branch `fix/fixed-layout-turn-evicts-touched-frame`, worktree `/Users/chrox/dev/readest-fix-fixed-layout-turn-evicts-touched-frame`). **MERGED to readest main as #6250 (10b6452bc)** + foliate #100 (085ab9c). chrox CONFIRMED on the Xiaomi (fixed dev build 8a635956): curl + slide on PDF work; Push has no animation on FXL at all (instant swap) — next design.**

**Root cause (device-traced):** the captured turn runs `navigate()` under the overlay while the finger is still down on the outgoing page's iframe. `goToSpread` → `#preloadNextSpreads` → `#cleanupPreloadCache` trims `#prerenderedSpreads` to `#maxCachedSpreads = 2` by access time, and the outgoing spread's stamp dates from when it was *shown* — older than every preload made since — so on every **backward** turn it was evicted: `element.remove()` on the touched iframe. Detaching the iframe destroys its document and Chromium drops the rest of the touch sequence silently — **no touchend, no touchcancel** — so `endDrag` never runs and the overlay freezes at the last sample. The next swipe first cancels the open drag (`endDrag(false)` = navigate forward again) then hits the same wall. Forward turns escaped: the N+2 preload only overflows the cache on the *next* turn. Hidden (`visibility:hidden; pointer-events:none`) is fine; **detached is fatal**.

**Fix:** stamp the spread being left in `goToSpread` before the trim (`#touchSpread`), and stamp with a monotonic `#spreadAccessTick` instead of `Date.now()` (same-ms ties fell back to Map insertion order = current spread oldest). Spreads two turns back still trimmed.

**Ruled out:** `preventDefault` on touchmove (frame protected + no preventDefault still completed); slow PDF `navigate()` (13–60 ms even uncached on a 627-page scan); `#pending` chain wedge (programmatic prev always resolved). Tap-turn rAF pacing PDF vs EPUB on the Xiaomi: PDF 57–58 frames/500 ms, 0 frames >33 ms; EPUB 67/600 ms, 1 frame >33 ms — PDF is NOT less smooth for taps; the feel complaint was the gesture path.

**Why scripted drags missed it:** every CDP drag started at x=18 — inside the 39 px brightness inset (`turn-gesture-left-inset=0.1`) → `earlyClaimBlocked` → warm surface *invalidated* → cold capture → navigate ~170 ms later with a different cache state. A finger lands at x=54–91 → warm surface → navigate within ~10 ms. **Start scripted turn drags at x≈80, never in the inset.**

**Still open (parity, not the freeze):** for `foliate-fxl` nothing `preventDefault`s the claiming touchmove (`getNativeTurnHost` gates on `localName === 'foliate-paginator'`), so the browser starts a native pan: `pointercancel` + non-cancelable touchmoves. EPUB gets the early claim + click suppression there. Measure before changing.

**CDP lessons this session:** deep-link "reload" is an SPA route change — `window.__*` guards survive while the renderer is replaced, so re-arm hooks on the CURRENT `foliate-view`'s renderer; `head -N` truncated the decisive tail twice — write logs to a file and grep; one stuck client blocks the endpoint (`pkill` first). See [[cdp-android-webview-profiling]], [[feedback-always-verify-on-xiaomi]].
