---
name: paragraph-mode-accidental-exit-4474
description: Paragraph mode exited on stray taps + control bar off-center with pinned sidebar; fix = reveal-bar event + absolute→fixed
metadata: 
  node_type: memory
  type: project
  originSessionId: 3f480cd2-ca07-4eef-ac23-e60e497f882b
---

#4474 (FR "prevent accidental exit from paragraph mode"). Paragraph/focus mode = full-screen `ParagraphOverlay` (one centered paragraph) + auto-hiding `ParagraphBar` (prev/next/exit pill). Files: `src/app/reader/components/paragraph/{ParagraphOverlay,ParagraphBar,ParagraphControl}.tsx`, hook `useParagraphMode.ts`. Overlay↔bar talk ONLY via `eventDispatcher` (`paragraph-focus`/`-next`/`-prev`/`-mode-disabled`/`-section-changing`/`toggle-paragraph-mode`).

**Accidental-exit bug:** overlay `handleBackdropClick` closed on tapping the empty area around the centered paragraph (the "too high/low" complaint); `handleContentClick` center-zone tap did nothing; double-tap closes. CRITICAL gotcha: `ParagraphBar` only reshows on `mousemove` — there is NO touch gesture to bring it back once auto-hidden. So you can't just delete the stray-tap exits or touch users get stranded with no exit. Fix = new `paragraph-show-controls` event (bookKey-scoped): backdrop tap + center-zone tap dispatch it instead of exiting; bar listens → `showBar()`. Exit now only via bar ✕, Esc/Backspace, or deliberate double-tap-on-paragraph (kept per user choice).

**Off-center bar bug (same PR):** bar was `absolute bottom-6 left-1/2 -translate-x-1/2` → centers on its positioned ancestor = the gridcell `#gridcell-<key>` (`relative` in `BooksGrid.tsx`). Reader layout is `flex`: `<SideBar/><BooksGrid/>`; a PINNED sidebar uses `position:relative` (`SideBar.tsx`, in-flow width) and shifts the gridcell right. The paragraph centers on the viewport because the overlay is `fixed inset-0` (its blur even covers the pinned sidebar, so the screenshot shows no sidebar). Mismatch → bar drifts right. Fix = `absolute`→`fixed` so the bar anchors to the viewport like the overlay. Safe: no ancestor transforms (gridcell/books-grid/reader-content are plain). Multi-book 2-up paragraph mode already overlaps (overlay is per-book full-viewport), so `fixed` introduces no new regression.

Tests: `src/__tests__/paragraph-mode.test.tsx` (overlay: backdrop+center tap → show-controls not exit; double-tap still exits) and `src/__tests__/paragraph-bar.test.tsx` (root has `fixed` not `absolute`; show-controls reappears bar after auto-hide via fake timers; ignores other bookKey). Related: [[progressbar-focus-ring-4397]], [[paginator-gutter-bleed-asymmetry-4394]].
