---
name: toc-expand-and-autoscroll
description: TOC sidebar auto-expansion policy + the Virtuoso scrollToIndex-after-expansion race that breaks the initial scroll-to-current-chapter
metadata: 
  node_type: memory
  type: project
  originSessionId: 4d4eefcb-324a-4342-9472-9dae7cc57b41
---

Issue #4059: the TOC sidebar used to auto-expand *every* top-level container (`computeExpandedSet` added all `toc.filter(item => item.subitems?.length)`), so multi-volume books ("文学必读合集20册") opened fully expanded. Fix: expand only the current location's ancestor path (`findParentPath`), with a single-root fallback (expand `toc[0]` only when `toc.length === 1`) so a one-root-wrapper TOC isn't reduced to one row. Pure logic lives in `src/app/reader/components/sidebar/tocTree.ts` (extracted from TOCView so it's unit-testable — TOCView itself can't be imported in jsdom: react-virtuoso + OverlayScrollbars CSS).

Collapsing-by-default introduced a **regression**: the current chapter no longer scrolled into view on fresh load. Root cause is two-fold, both stemming from the pinned sidebar mounting *before* the first relocate (progress is null at mount, so `initialScrollTarget.index` is 0 and Virtuoso's `initialTopMostItemIndex` can't anchor):

1. When progress arrives, the current volume expands and the virtualized list grows by dozens of rows in one commit. Virtuoso emits a synthetic `onScroll`; the old handler treated *any* scroll while a scroll was queued as "user took over" and cleared `pendingScrollRef`. Fix: ignore a queued-state scroll unless a real gesture preceded it — track `userInputRef` via capture-phase `wheel`/`touchstart`/`pointerdown`/`keydown` listeners on the scroller; `if (pendingScrollRef.current && !userInputRef.current) return;`.
2. Even with pending preserved, a single `scrollToIndex(idx, {align:'center'})` fired in the same commit as the 28→90 row growth **lands short** — Virtuoso scrolls before measuring the new rows. Fix: re-assert the scroll on the next `requestAnimationFrame` (only for the instant `behavior:'auto'` case). The toggle-sidebar (remount) path always worked because remounting feeds `initialTopMostItemIndex` before first render.

Verified live: 红楼梦 book at `/reader/217e3f1e...` — only 下卷 expanded, current chapter centered (0px from viewport center), user scroll no longer snaps back. Related: [[issue-4112-scroll-anchoring]], [[reading-ruler-line-aware]], [[virtuoso_overlayscrollbars]].
