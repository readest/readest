---
name: pages-left-counter-stall-6442
description: "#6442 chapter pages-left counter stalled/skipped on Android + #6450 last page read \"2 left\" (same cause, closed); regression from #6319; MERGED #6447 UNRELEASED, Xiaomi-VERIFIED"
metadata:
  type: project
---

#6442 (2026-09-29): "N pages left in chapter" updated only every 2nd/3rd page turn on Android. REGRESSION from #6319 (5742ae54d), which computed `ceil((tocEnd - pageinfo.current) / locationsPerScreen)`. `pageinfo.current` = foliate `Math.floor(bytes/1500)`; a phone screen holds less than 1500 bytes, so it stays put across turns.

Fix (ProgressBar.tsx + `getChapterEndLocation` in utils/progress.ts): estimate only the chapter END as a screen index in the current section (`bookDoc.sections[i].location` for the boundary, round), then `pagesLeft = endScreen - renderer.page`. That count drops by exactly 1 per turn. The time estimate still uses rounded locations.

Xiaomi before the fix: 8,8,6,5,3,3,2. After: 21→1 in single steps, then it resets on the next chapter. Tested via the dev-android build + CDP reading `.progressinfo` aria-label plus `adb input tap 1000 1200`.

**How to apply:** never derive per-screen counters from foliate's floored locations; use renderer page/pages. Related: [[paginator-scroll-fixes]].

#6450 (2026-09-29, 0.12.10, all platforms): the last page of a chapter showed "2 pages left". Same #6319 cause: the floored location overstates the remainder by up to 1 location, so ceil(1/lps) = 2. Fixed by #6447; the user verified it on Xiaomi; closed.
