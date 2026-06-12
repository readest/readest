---
name: android-hyphen-selection-bounds-1553
description: "#1553 Android selection breaks on first word of hyphenated paragraphs — Blink generated-hyphen bounds bug, full RCA + app-side repair/suppress fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 16f94822-04b0-4be3-a47e-8a2e3cab290a
---

Issue #1553 root cause (verified live on Xiaomi 13, WebView 147, via [[cdp-android-webview-profiling]]):

**Upstream**: filed as crbug **522869957** (2026-06-12, by chrox, with full analysis + repro + screenshot). Pre-existing same-root-cause report: crbug **41496034** (Jan 2024, "&shy;" framing — why searches missed it; P2 Available, on "Rendering Core 2026 Fixit" hotlist; MS triager confirmed soft-hyphen cause in Feb 2024). Cross-link comments posted on both.

**Blink bug** — `LayoutSelection::ComputePaintingSelectionStateForCursor` (third_party/blink/renderer/core/editing/layout_selection.cc) compares `paint_range_` offsets (paragraph **IFC text-content space**, via `OffsetMapping::GetTextContentOffset`) against `position.TextOffset()` — but auto/soft-hyphen fragments are **layout-generated text with self-relative offsets {0,1}**. So a touch selection starting at IFC offset 0 (first word of a paragraph) makes EVERY hyphen fragment in that paragraph report `kStart` → each records a start bound (`SelectionBoundsRecorder`, last paint wins) → **native start handle is drawn at the paragraph's LAST hyphen**. The highlight itself is correct because the sibling path `ComputeSelectionStatus(InlineCursor&)` HAS the `IsLayoutGeneratedText()` remap; the bounds path lacks it. Still unfixed upstream as of Chromium main (June 2026); seemingly unreported.

Key facts:
- Trigger: touch selection (handles visible — `ShouldRecordSelection` gates on `IsHandleVisible()`, so desktop/mouse unaffected; iOS=WebKit unaffected) + selection start at IFC offset ≤1 + generated hyphens in the same paragraph. **Multicol NOT required** (reproduced in a plain top-document div).
- Worse than cosmetic: long-press **drag-extension re-anchors the base by hit-testing the bogus bound** → observed anchor jump 0→325 (offset just before last hyphen), selection became [53,325] instead of [0,53]. Explains "select upward works" workaround (upward drags anchor on the correct end bound).
- Auto-hyphens show up as separate ~0.3em rects in `Range.getClientRects()` on hyphenated lines — usable as a generated-hyphen detector.
- **JS `removeAllRanges()+addRange()` does NOT hide already-visible touch handles synchronously** — the empty selection must commit through one painted frame (double-rAF in the iframe window) before re-adding; then handles stay hidden for all later JS selection updates.

Fix (branch fix/android-hyphen-selection-1553): detection utils in `src/utils/sel.ts` (`isHyphenHandleBugProneRange`, `repairJumpedSelectionRange`, `hasTrailingHyphenRectPattern`); gesture-initial anchor capture + touchend sanitize in `useTextSelector` (repair jumped anchor → suppress handles via empty-commit → `makeSelection(handlesSuppressed)`); `SelectionRangeEditor.tsx` renders custom drag handles (reuses `Handle` + extracted `buildRangeFromPoints`/`getHandlePositionsFromRange` in annotatorUtil) for suppressed selections. Gated to Android app + exact bug condition; flipping to always-custom-handles later = drop the proneness gate.

Gotcha: `input motionevent DOWN/MOVE/UP` (adb) simulates long-press-drag; `input swipe x y x y 700` simulates plain long-press.

Two post-fix races found by chrox & fixed (commits c6e9f48, 9a63157):
1. **Tap-dismiss resurrection** — an Android tap doesn't clear the selection, it COLLAPSES it to a caret at the tap point, with selectionchange ~10-20ms AFTER touchend; the tap's touchend re-entered sanitize (fallback prone-check on the still-valid old selection), the collapse raced into the double-rAF window (also MUTATING the held Range in place), and makeSelection committed a collapsed range as a suppressed selection → "empty custom handles at the tap spot". Fix = gesture gate (`if (!initial) return`) + post-rAF abort when `sel.rangeCount > 0 || finalRange.collapsed`.
2. **Extent overshoot** — the corrupted drag has TWO modes: base re-anchors at the bogus bound (anchor jump, Argentina test) OR the EXTENT lands there while the anchor stays at 0 (range then CONTAINS the initial anchor → jump-repair doesn't fire; observed +1013 chars). Fix = `rangeFromAnchorToPoint`: rebuild [gesture-initial anchor → caret at last native touch position] (`pointerPos`, reset per-gesture in handleTouchStart), fallback to jump-repair.

Verify-build gotcha: `pnpm dev-android` snapshots the Next bundle at build START — an amend after kickoff ships the PRE-amend frontend (grep of out/ chunks for comment text is a FALSE-POSITIVE check; compare out/ mtime vs commit time instead).
