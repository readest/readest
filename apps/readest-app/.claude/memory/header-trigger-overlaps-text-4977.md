---
name: header-trigger-overlaps-text-4977
description: "#4977 top bar blocks text selection — header hover trigger was a fixed 44px lid; fixed by sizing it to the content top (getHeaderTriggerHeight)"
metadata: 
  node_type: memory
  type: project
  originSessionId: d7118b42-d67a-4f24-80a0-6376930aacf0
  modified: 2026-08-03T17:30:18.914Z
---

#4977 (iPadOS 26.5, 0.11.17): "top bar's activation margin sits above the text, text at the top of the page cannot be selected." Same root cause as #5429.

**Root cause:** `HeaderBar`'s invisible hover trigger was `h-11` — 44px, sized to the *toolbar it reveals*, which happened to equal the DEFAULT `marginTopPx`. Any smaller content top (page header off -> `compactMarginTopPx` 16, a reduced margin, vertical writing mode) left the strip hanging over the first line, and it swallowed the press that should have started a selection.

**Fix (2026-08-04, on `dev`, not yet a PR):** `getHeaderTriggerHeight(topInset, viewSettings)` in `src/utils/insets.ts` — `min(44, contentTop)` where `contentTop` mirrors `FoliateViewer.applyMarginAndGap`'s `margin-top`: `showHeader && !vertical ? max(topInset + marginTopPx, 16) : marginTopPx` (the header-off branch drops the safe-area inset; the header-on branch floors at 16 via `moreTopInset`). Same "glued to the content top" rule as [[svg-cover-stretch-duokan-5375]]'s neighbour `getHeaderBandGeometry`.

**Why the platform gate wasn't enough:** #5429 (b17f06186) made the strip `pointer-events-none` when `appService.isMobile || innerWidth < 640`. That covers the reporter's NATIVE iPad app (OS_TYPE 'ios'), so #4977 was already fixed on `dev` for them — but NOT the web build on iPadOS: `getOSPlatform()` reads the UA and iPad Safari reports desktop ("Macintosh"), which `src/utils/misc.ts:89` documents explicitly. Touch laptops/2-in-1s were exposed the same way. Geometry beats UA sniffing here.

**How to apply:** an overlay strip anchored to a screen edge must be sized from the content it must not cover, never from the chrome it reveals. Check the whole family: the FooterBar trigger is `h-[52px]` with the same mobile-only gate.

**Coverage:** `getHeaderTriggerHeight` unit cases in `src/__tests__/utils/insets.test.ts`; real hit testing in `e2e/tests/annotation.spec.ts` ("first line of text hittable when the page header is off") — desktop Chromium is non-mobile, so it is the only lane where the strip is armed. New `ReaderPage` helpers: `setPageHeaderVisible`, `hideChrome`, `firstLineHitTestNearTop`. Verify red by stashing only `HeaderBar.tsx` — but see [[turbopack-dev-stale-chunk-phantom]], the stash churn poisons the dev server.
